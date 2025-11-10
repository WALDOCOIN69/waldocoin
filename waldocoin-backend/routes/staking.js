import express from 'express';
import { redis } from '../redisClient.js';
import getWaldoBalance from '../utils/getWaldoBalance.js';
import { xummClient } from '../utils/xummClient.js';
import xrpl from 'xrpl';
import { validateAdminKey, getAdminKey } from '../utils/adminAuth.js';
import { rateLimitMiddleware } from '../utils/rateLimiter.js';
import { createErrorResponse, logError } from '../utils/errorHandler.js';
import {
  calculateMaturity,
  createStakeId,
  calculateStakeAPY,
  calculateExpectedReward,
  createStakeData,
  cleanupCompletedStake,
  addToActiveSets,
  calculateEarlyUnstakePenalty
} from '../utils/stakingUtils.js';
import { DISTRIBUTOR_WALLET, TREASURY_WALLET, WALDO_ISSUER } from '../constants.js';

// XRPL connection with fallback nodes for better reliability
const XRPL_NODES = [
  'wss://xrplcluster.com',
  'wss://s1.ripple.com',
  'wss://s2.ripple.com',
  'wss://xrpl.ws'
];

async function getReliableXrplClient() {
  for (const node of XRPL_NODES) {
    try {
      const client = new xrpl.Client(node);
      await client.connect();
      console.log(`✅ Connected to XRPL node: ${node}`);
      return client;
    } catch (error) {
      console.warn(`❌ Failed to connect to ${node}:`, error.message);
      continue;
    }
  }
  throw new Error('All XRPL nodes failed to connect');
}

const ISSUER = WALDO_ISSUER;
const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || 'WLO').toUpperCase();
// Prefer dedicated staking vault or Treasury; only fall back to distributor if no vault/treasury configured
const STAKING_VAULT = process.env.WALDO_STAKING_VAULT || TREASURY_WALLET || DISTRIBUTOR_WALLET || 'rnWfL48YCknW6PYewFLKfMKUymHCfj3aww';

// ✅ DUAL STAKING SYSTEM CONFIGURATION

// XP level thresholds (using xpManager.js structure)
const XP_LEVELS = {
  1: { min: 0, max: 999, title: "Waldo Watcher" },
  2: { min: 1000, max: 2999, title: "Waldo Scout" },
  3: { min: 3000, max: 6999, title: "Waldo Agent" },
  4: { min: 7000, max: 14999, title: "Waldo Commander" },
  5: { min: 15000, max: Infinity, title: "Waldo Legend" }
};

// Long-term staking bonus rates by duration (encourage immediate staking with good 30-day rate)
const LONG_TERM_APY_RATES = {
  30: 12,   // 12% bonus for 30 days (attractive rate to get people staking now)
  90: 18,   // 18% bonus for 90 days
  180: 25,  // 25% bonus for 180 days
  365: 45   // 45% bonus for 365 days (massive reward for long-term commitment)
};

// Level-based duration access for long-term staking
const LEVEL_DURATION_ACCESS = {
  1: [30, 90],               // Level 1: 30 and 90-day available
  2: [30, 90, 180, 365],     // Level 2: All durations available
  3: [30, 90, 180, 365],     // Level 3: All durations available
  4: [30, 90, 180, 365],     // Level 4: All durations available
  5: [30, 90, 180, 365]      // Level 5: All durations + bonus
};

// Level 5 Legend bonus (+2% APY)
const LEGEND_BONUS = 0.02; // +2% APY for Level 5

// Per-meme staking configuration (whitepaper)
const PER_MEME_CONFIG = {
  bonus: 0.15,        // Fixed 15% bonus
  duration: 30,       // Fixed 30-day lock
  stakingFee: 0.05,   // 5% staking fee
  instantFee: 0.10    // 10% instant fee
};

// Long-term staking configuration
let LONG_TERM_CONFIG = {
  minimumAmount: 1000,
  earlyUnstakePenalty: 0.15,
  maxActiveStakes: 10
};

// Load dynamic staking config from Redis-configurable settings
async function refreshLongTermConfig() {
  try {
    const { getStakingConfig } = await import("../utils/config.js");
    const cfg = await getStakingConfig();
    LONG_TERM_CONFIG = {
      minimumAmount: cfg.minimumAmountLongTerm,
      earlyUnstakePenalty: cfg.earlyUnstakePenalty,
      maxActiveStakes: cfg.maxActiveStakes
    };
  } catch (e) {
    console.warn('Using default LONG_TERM_CONFIG (could not load from config):', e.message || e);
  }
}

// Prime config on module load (non-blocking), and refresh lazily in handlers
refreshLongTermConfig().catch(() => { });


// Calculate user's XP level (durations are NOT gated; everyone gets all configured durations)
function getUserLevel(xp) {
  const allDurations = Object.keys(LONG_TERM_APY_RATES).map(d => parseInt(d));
  for (const [level, data] of Object.entries(XP_LEVELS)) {
    if (xp >= data.min && xp <= data.max) {
      return {
        level: parseInt(level),
        title: data.title,
        xp: xp,
        availableDurations: allDurations
      };
    }
  }
  return { level: 1, title: "Waldo Watcher", xp: 0, availableDurations: allDurations };
}

const router = express.Router();

// Helper function to process redemption if transaction is complete
async function processRedemptionIfComplete(uuid) {
  try {
    const p = await xummClient.payload.get(uuid).catch(() => null);
    if (!p) return false;

    const signed = !!p?.meta?.signed;
    const account = p?.response?.account || null;
    const txid = p?.response?.txid || null;
    if (!signed) return false;

    // Check if Payment transaction was successful
    const paymentSuccessful = p?.response?.dispatched_result === 'tesSUCCESS';
    if (!paymentSuccessful) return false;

    // Check if already processed
    const processedKey = `stake:redeem_processed:${uuid}`;
    const alreadyProcessed = await redis.get(processedKey);
    if (alreadyProcessed) return true;

    // Get stake info and mark as completed
    const offer = await redis.hGetAll(`stake:redeem_offer:${uuid}`);
    const stakeId = offer?.stakeId;
    const wallet = offer?.wallet;
    if (!stakeId || !wallet) return false;

    const stakeKey = `staking:${stakeId}`;
    const stakeData = await redis.hGetAll(stakeKey);
    if (!stakeData) return false;

    // Check if already processed
    if (stakeData.status === 'redeemed' && stakeData.redeemedAt) {
      console.log(`[REDEEM-FALLBACK] Stake already redeemed, skipping update`);
      return true;
    }

    // Mark stake as completed
    const redeemedAt = new Date().toISOString();
    const originalAmount = parseFloat(stakeData.amount || 0);
    const expectedReward = parseFloat(stakeData.expectedReward || 0);
    const totalAmount = originalAmount + expectedReward;

    await redis.hSet(stakeKey, {
      status: 'redeemed',
      redeemedAt: redeemedAt,
      redeemTx: txid || '',
      claimed: 'true',
      totalReceived: totalAmount.toString(),
      originalAmount: originalAmount.toString(),
      rewardAmount: expectedReward.toString()
    });

    // Remove from active sets and add to redeemed set
    await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);
    await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);

    // Update stats
    const amt = Number(stakeData.amount || 0);
    if (Number.isFinite(amt) && amt > 0) {
      try { await redis.incrByFloat('staking:total_staked', -amt); } catch (_) { }
      try { await redis.incrByFloat('staking:total_long_term_staked', -amt); } catch (_) { }
    }

    // Mark as processed and clean up
    await redis.set(processedKey, '1', { EX: 604800 });
    await redis.del(`stake:redeem_offer:${uuid}`);

    console.log(`✅ [FALLBACK] Stake redeemed: ${wallet} received ${totalAmount.toFixed(2)} WALDO (${stakeId})`);
    return true;
  } catch (e) {
    console.error('[REDEEM-FALLBACK] Processing error:', e);
    return false;
  }
}

// ✅ GET /api/staking/cors-test - Test CORS configuration
router.get("/cors-test", async (req, res) => {
  try {
    return res.json({
      success: true,
      message: 'CORS test successful',
      origin: req.headers.origin,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ GET /api/staking/test-unstake - Test unstake QR generation
router.get("/test-unstake", async (req, res) => {
  try {
    const testWallet = 'rTestWalletAddress123456789';
    const testAmount = 1000;
    const penalty = testAmount * 0.15;
    const userReceives = testAmount - penalty;

    const DISTRIBUTOR_WALLET = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
    const ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
    const CURRENCY = process.env.WALDO_CURRENCY || 'WLO';

    const memoType = Buffer.from('UNSTAKE_TEST').toString('hex').toUpperCase();
    const memoData = Buffer.from('test123').toString('hex').toUpperCase();

    const txjson = {
      TransactionType: 'Payment',
      Account: DISTRIBUTOR_WALLET,
      Destination: testWallet,
      Amount: {
        currency: CURRENCY,
        issuer: ISSUER,
        value: userReceives.toString()
      },
      Memos: [{ Memo: { MemoType: memoType, MemoData: memoData } }]
    };

    console.log('[TEST-UNSTAKE] Creating XUMM payload with:', txjson);

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: false, expire: 300 },
      custom_meta: {
        identifier: `WALDO_STAKE_UNSTAKE_TEST`,
        instruction: `TEST: Early unlock ${userReceives.toFixed(2)} WALDO (${testAmount} - ${penalty.toFixed(2)} penalty)`
      }
    });

    console.log('[TEST-UNSTAKE] XUMM response:', created);

    return res.json({
      success: true,
      message: 'Test unstake QR generated successfully',
      uuid: created.uuid,
      refs: created.refs,
      next: created.next,
      txjson
    });
  } catch (e) {
    console.error('[TEST-UNSTAKE] Error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ POST /api/staking/long-term - Create long-term staking position
router.post("/long-term", rateLimitMiddleware('PAYMENT_CREATE', (req) => req.body.wallet), async (req, res) => {
  try {
    console.log('[LT] Raw request body:', req.body);
    const { wallet, amount, duration } = req.body;

    if (!wallet || amount == null || duration == null) {
      console.log('[LT] Missing fields:', { wallet: !!wallet, amount: amount, duration: duration });
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, duration"
      });
    }

    console.log('[LT] Incoming request', { wallet, amount, duration, type: typeof amount, type2: typeof duration });
    // No global WALDO-worth requirement for long‑term staking; per‑meme staking retains worth checks.

    // Validate amount
    const stakeAmount = parseFloat(amount);
    console.log('[LT] Amount validation:', { amount, stakeAmount, isFinite: Number.isFinite(stakeAmount), minimum: LONG_TERM_CONFIG.minimumAmount });
    if (!Number.isFinite(stakeAmount) || stakeAmount < LONG_TERM_CONFIG.minimumAmount) {
      console.log('[LT] Amount validation failed');
      return res.status(400).json({
        success: false,
        error: `Minimum stake amount is ${LONG_TERM_CONFIG.minimumAmount} WALDO`
      });
    }

    // Validate duration
    const validDurations = Object.keys(LONG_TERM_APY_RATES);
    console.log('[LT] Duration validation:', { duration, durationStr: duration.toString(), validDurations });
    if (!validDurations.includes(duration.toString())) {
      console.log('[LT] Duration validation failed');
      return res.status(400).json({
        success: false,
        error: "Invalid duration. Must be 30, 90, 180, or 365 days"
      });
    }

    // Get user's current WALDO balance
    const currentBalance = await getWaldoBalance(wallet);
    console.log('[LT] Current balance', currentBalance);
    if (currentBalance < stakeAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${currentBalance} WALDO, trying to stake ${stakeAmount} WALDO`
      });
    }

    // Get user's XP and level
    const userXP = await redis.get(`user:${wallet}:xp`) || 0;
    const userLevel = getUserLevel(parseInt(userXP));

    // Duration access is not gated by level anymore; allow all configured durations
    // Check maximum active stakes limit (count only currently 'active' long‑term stakes)
    let _activeCount = 0;
    try {
      const idsA = await redis.sMembers(`user:${wallet}:long_term_stakes`);
      const idsB = await redis.sMembers(`staking:user:${wallet}`);
      const ids = Array.from(new Set([...(idsA || []), ...(idsB || [])]));
      for (const id of ids) {
        const data = await redis.hGetAll(`staking:${id}`);
        if (!data || Object.keys(data).length === 0) continue;
        const status = data.status;
        const type = data.type || 'long_term';
        if (status === 'active' && (type === 'long_term' || !type)) _activeCount++;
      }
    } catch (_) { /* best-effort */ }
    if (_activeCount >= LONG_TERM_CONFIG.maxActiveStakes) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${LONG_TERM_CONFIG.maxActiveStakes} active long-term stakes allowed`
      });
    }

    // Calculate APY with Level 5 bonus
    const apy = calculateStakeAPY(parseInt(duration), userLevel.level);

    // Calculate expected rewards as flat bonus (not annualized APY)
    const rewardCalculation = stakeAmount * (apy / 100); // Simple percentage bonus
    const expectedReward = Math.floor(rewardCalculation * 100) / 100; // Round to 2 decimals, then floor

    // Create staking record
    const stakeId = `longterm_${wallet}_${Date.now()}`;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));

    const stakeData = {
      stakeId,
      wallet,
      amount: stakeAmount,
      duration: parseInt(duration),
      apy: apy,
      userLevel: userLevel.level,
      userTitle: userLevel.title,
      expectedReward: expectedReward,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'pending_signature',
      type: 'long_term',
      earlyUnstakePenalty: LONG_TERM_CONFIG.earlyUnstakePenalty,
      claimed: false,
      createdAt: new Date().toISOString()
    };

    console.log('[LT] Writing stake to Redis', { key: `staking:${stakeId}` });
    // Store staking record (stringify values to satisfy Redis types)
    const stakeDataStr = Object.fromEntries(Object.entries(stakeData).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]));
    await redis.hSet(`staking:${stakeId}`, stakeDataStr);

    console.log('[LT] Adding stake to user set');
    // Add to user's active long-term stakes
    await redis.sAdd(`user:${wallet}:long_term_stakes`, stakeId);

    // Do NOT update global totals yet; wait until the user signs & funds the stake

    // Create XUMM payload so user moves WALDO to staking vault to fund the lock
    const txjson = {
      TransactionType: 'Payment',
      Destination: STAKING_VAULT,
      Amount: { currency: CURRENCY, issuer: ISSUER, value: String((Math.floor(stakeAmount * 1e6) / 1e6).toFixed(6)) },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('STAKE_LONG').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`${duration}d:${stakeId}`).toString('hex').toUpperCase()
        }
      }]
    };

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 900, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: `WALDO_STAKE_LONG_${duration}` }
    });

    // Mark stake as pending signature & persist mapping for status processing
    await redis.hSet(`staking:${stakeId}`, { status: 'pending_signature', xummUuid: created.uuid });
    await redis.hSet(`stake:offer:${created.uuid}`, { stakeId, wallet, amount: String(stakeAmount), duration: String(duration) });

    console.log(`🏦 Long-term stake pending signature: ${stakeId} for ${wallet}, amount ${stakeAmount} WALDO, ${duration}d`);

    res.json({
      success: true,
      message: `Sign in Xaman to lock ${stakeAmount} WALDO for ${duration} days`,
      stakeData: {
        stakeId,
        amount: stakeAmount,
        duration: parseInt(duration),
        apy: `${apy}%`,
        userLevel: userLevel.level,
        userTitle: userLevel.title,
        expectedReward: expectedReward,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        earlyUnstakePenalty: `${(LONG_TERM_CONFIG.earlyUnstakePenalty * 100)}%`,
        status: 'pending_signature'
      },
      uuid: created.uuid,
      refs: created.refs,
      next: created.next,
      // Convenience fields for simple clients
      qr_png: created?.refs?.qr_png,
      qr_uri: created?.refs?.qr_uri || created?.refs?.qr,
      deeplink: created?.next?.always || created?.next?.app
    });



  } catch (error) {
    console.error('❌ Error creating long-term stake:', error?.stack || error);
    res.status(500).json({
      success: false,
      error: "Failed to create long-term staking position",
      details: error?.message || String(error)
    });
  }
});

// ✅ POST /api/staking/per-meme - Create per-meme staking position (whitepaper system)
router.post("/per-meme", rateLimitMiddleware('PAYMENT_CREATE', (req) => req.body.wallet), async (req, res) => {
  try {
    const { wallet, amount, memeId } = req.body;

    if (!wallet || !amount || !memeId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, memeId"
      });
    }

    // Validate amount
    const stakeAmount = parseFloat(amount);
    if (isNaN(stakeAmount) || stakeAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid stake amount"
      });
    }

    // Calculate staking fee (5% vs 10% instant fee)
    const stakingFee = Math.floor(stakeAmount * PER_MEME_CONFIG.stakingFee);
    const stakedAmount = stakeAmount - stakingFee;

    // Calculate bonus (15% fixed bonus)
    const bonusAmount = Math.floor(stakedAmount * PER_MEME_CONFIG.bonus);
    const totalReward = stakedAmount + bonusAmount;

    // Create per-meme staking record
    const stakeId = `permeme_${wallet}_${Date.now()}`;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (PER_MEME_CONFIG.duration * 24 * 60 * 60 * 1000));

    const stakeData = {
      stakeId,
      wallet,
      memeId,
      originalAmount: stakeAmount,
      stakingFee: stakingFee,
      stakedAmount: stakedAmount,
      bonusAmount: bonusAmount,
      totalReward: totalReward,
      duration: PER_MEME_CONFIG.duration,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      type: 'per_meme',
      claimed: false,
      createdAt: new Date().toISOString()
    };

    // Store staking record (stringify values to satisfy Redis types)
    const stakeDataStr = Object.fromEntries(Object.entries(stakeData).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]));
    await redis.hSet(`staking:${stakeId}`, stakeDataStr);

    // Add to user's per-meme stakes
    await redis.sAdd(`user:${wallet}:per_meme_stakes`, stakeId);

    // Do NOT update global totals yet; wait until user signs & funds via Xaman

    // Create XUMM payload so user moves WALDO to staking vault (full original amount)
    const txjson = {
      TransactionType: 'Payment',
      Destination: STAKING_VAULT,
      Amount: { currency: CURRENCY, issuer: ISSUER, value: String((Math.floor(stakeAmount * 1e6) / 1e6).toFixed(6)) },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('STAKE_MEME').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`${memeId}:${stakeId}`).toString('hex').toUpperCase()
        }
      }]
    };

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 900, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: `WALDO_STAKE_MEME_${memeId}` }
    });

    // Mark as pending signature & persist mapping for status processing
    await redis.hSet(`staking:${stakeId}`, { status: 'pending_signature', xummUuid: created.uuid });
    await redis.hSet(`stake:offer:${created.uuid}`, { stakeId, wallet, amount: String(stakeAmount), type: 'per_meme', memeId });

    console.log(`🎭 Per-meme stake pending signature: ${stakeId} for ${wallet}, amount ${stakeAmount} WALDO, meme ${memeId}`);

    res.json({
      success: true,
      message: `Sign in Xaman to lock ${stakedAmount} WALDO (after 5% fee) for meme ${memeId}`,
      stakeData: {
        stakeId,
        memeId,
        originalAmount: stakeAmount,
        stakingFee: stakingFee,
        stakedAmount: stakedAmount,
        bonusAmount: bonusAmount,
        totalReward: totalReward,
        duration: PER_MEME_CONFIG.duration,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        status: 'pending_signature'
      },
      uuid: created.uuid,
      refs: created.refs,
      next: created.next,
      // Convenience fields for simple clients
      qr_png: created?.refs?.qr_png,
      qr_uri: created?.refs?.qr_uri || created?.refs?.qr,
      deeplink: created?.next?.always || created?.next?.app
    });

  } catch (error) {
    console.error('❌ Error creating per-meme stake:', error);
    res.status(500).json({
      success: false,
      error: "Failed to create per-meme staking position"
    });
  }
});

// ✅ GET /api/staking/info/:wallet - Get dual staking system info for user
router.get("/info/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    // Get user's XP and level
    const userXP = await redis.get(`user:${wallet}:xp`) || 0;
    const userLevel = getUserLevel(parseInt(userXP));

    // Get user's current balance
    const currentBalance = await getWaldoBalance(wallet);

    // Get user's long-term stakes (aggregate across both schemas)
    const longTermStakes = [];
    const seen = new Set();

    // Schema A: dedicated long-term set
    const ltSetIds = await redis.sMembers(`user:${wallet}:long_term_stakes`);
    for (const stakeId of ltSetIds) {
      try {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);
        if (stakeData && stakeData.status === 'active') {
          const now = new Date();
          const endDate = new Date(stakeData.endDate);
          const timeRemaining = Math.max(0, endDate - now);
          const daysRemaining = timeRemaining <= 0 ? 0 : Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
          longTermStakes.push({
            stakeId: stakeData.stakeId,
            amount: parseFloat(stakeData.amount),
            duration: parseInt(stakeData.duration),
            apy: `${parseFloat(stakeData.apy)}%`,
            startDate: stakeData.startDate,
            endDate: stakeData.endDate,
            expectedReward: parseFloat(stakeData.expectedReward),
            daysRemaining,
            status: stakeData.status,
            type: 'long_term'
          });
          seen.add(stakeId);
        }
      } catch (error) {
        console.error(`Error processing long-term stake (schema A) ${stakeId}:`, error);
      }
    }

    // Schema B: generic staking set used by stats page
    const genericIds = await redis.sMembers(`staking:user:${wallet}`);
    for (const stakeId of genericIds) {
      if (seen.has(stakeId)) continue;
      try {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);
        if (stakeData && stakeData.status === 'active' && (stakeData.type === 'long_term' || stakeData.type == null)) {
          const now = new Date();
          const endDate = new Date(stakeData.endDate);
          const timeRemaining = Math.max(0, endDate - now);
          const daysRemaining = timeRemaining <= 0 ? 0 : Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
          longTermStakes.push({
            stakeId: stakeData.stakeId,
            amount: parseFloat(stakeData.amount),
            duration: parseInt(stakeData.duration),
            apy: `${parseFloat(stakeData.apy)}%`,
            startDate: stakeData.startDate,
            endDate: stakeData.endDate,
            expectedReward: parseFloat(stakeData.expectedReward || 0),
            daysRemaining,
            status: stakeData.status,
            type: 'long_term'
          });
          seen.add(stakeId);
        }
      } catch (error) {
        console.error(`Error processing long-term stake (schema B) ${stakeId}:`, error);
      }
    }

    // Get user's per-meme stakes
    const perMemeStakeIds = await redis.sMembers(`user:${wallet}:per_meme_stakes`);
    const perMemeStakes = [];

    for (const stakeId of perMemeStakeIds) {
      try {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);
        if (stakeData.status === 'active') {
          const now = new Date();
          const endDate = new Date(stakeData.endDate);
          const timeRemaining = Math.max(0, endDate - now);


          const daysRemaining = timeRemaining <= 0 ? 0 : Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

          perMemeStakes.push({
            stakeId: stakeData.stakeId,
            memeId: stakeData.memeId,
            originalAmount: parseFloat(stakeData.originalAmount),
            stakedAmount: parseFloat(stakeData.stakedAmount),
            bonusAmount: parseFloat(stakeData.bonusAmount),
            totalReward: parseFloat(stakeData.totalReward),
            duration: parseInt(stakeData.duration),
            startDate: stakeData.startDate,
            endDate: stakeData.endDate,
            daysRemaining: daysRemaining,
            status: stakeData.status,
            type: 'per_meme'
          });
        }
      } catch (error) {
        console.error(`Error processing per-meme stake ${stakeId}:`, error);
      }
    }

    // Calculate available durations with APY rates
    const availableDurations = userLevel.availableDurations.map(duration => ({
      days: duration,
      apy: `${calculateStakeAPY(duration, userLevel.level)}%`,
      baseAPY: `${LONG_TERM_APY_RATES[duration]}%`,
      legendBonus: userLevel.level === 5 ? `+${LEGEND_BONUS * 100}%` : null
    }));

    res.json({
      success: true,
      userInfo: {
        wallet,
        xp: parseInt(userXP),
        level: userLevel.level,
        title: userLevel.title,
        currentBalance: currentBalance,
        availableDurations: userLevel.availableDurations
      },
      longTermStaking: {
        activeStakes: longTermStakes,
        totalActiveStakes: longTermStakes.length,
        maxActiveStakes: LONG_TERM_CONFIG.maxActiveStakes,
        minimumAmount: LONG_TERM_CONFIG.minimumAmount,
        availableDurations: availableDurations,
        earlyUnstakePenalty: `${(LONG_TERM_CONFIG.earlyUnstakePenalty * 100)}%`
      },
      perMemeStaking: {
        activeStakes: perMemeStakes,
        totalActiveStakes: perMemeStakes.length,
        fixedBonus: `${(PER_MEME_CONFIG.bonus * 100)}%`,
        duration: `${PER_MEME_CONFIG.duration} days`,
        stakingFee: `${(PER_MEME_CONFIG.stakingFee * 100)}%`,
        instantFee: `${(PER_MEME_CONFIG.instantFee * 100)}%`
      },
      levelInfo: Object.entries(XP_LEVELS).map(([level, data]) => ({
        level: parseInt(level),
        title: data.title,
        xpRange: `${data.min}${data.max === Infinity ? '+' : `-${data.max}`}`,
        availableDurations: LEVEL_DURATION_ACCESS[parseInt(level)],
        legendBonus: parseInt(level) === 5 ? `+${LEGEND_BONUS * 100}% APY` : null
      }))
    });

  } catch (error) {
    console.error('❌ Error getting dual staking info:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get staking information"
    });
  }
});

// ✅ POST /api/staking/unstake - Create XUMM payload for unstaking
router.post("/unstake", async (req, res) => {
  console.log('[UNSTAKE] Request received:', { wallet: req.body.wallet, stakeId: req.body.stakeId });

  try {
    const { wallet, stakeId } = req.body;

    if (!wallet || !stakeId) {
      return res.status(400).json({
        success: false,
        error: "Missing wallet or stakeId"
      });
    }

    // Get staking record
    const stakeData = await redis.hGetAll(`staking:${stakeId}`);

    if (!stakeData || Object.keys(stakeData).length === 0) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found"
      });
    }

    if (!stakeData.wallet || stakeData.wallet !== wallet) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found or not owned by wallet"
      });
    }

    if (stakeData.status !== 'active') {
      // If stake is already completed but still in active sets, clean up the sets
      if (stakeData.status === 'completed' || stakeData.status === 'redeemed') {
        console.log(`[UNSTAKE] Cleaning up sets for already processed stake: ${stakeId}`);
        await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
        await redis.sRem(`staking:user:${wallet}`, stakeId);
        await redis.sRem('staking:active', stakeId);
        await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);
      }

      // Idempotent behavior: if already processed, return success with details
      return res.json({
        success: true,
        already: true,
        status: stakeData.status,
        txid: stakeData.unstakeTx || null,
        message: 'Stake already processed'
      });
    }

    // Idempotency lock to prevent duplicate payouts from double-clicks
    const lockKey = `stake:unstake:lock:${stakeId}`;
    const locked = await redis.set(lockKey, '1', { NX: true, EX: 120 });
    if (!locked) {
      return res.json({ success: true, inProgress: true, message: 'Unstake already in progress' });
    }

    // Calculate early unstaking amount (with 15% penalty)
    const originalAmount = parseFloat(stakeData.amount || 0);
    const penalty = originalAmount * 0.15;
    const userReceives = originalAmount - penalty;

    // Get distributor wallet credentials
    const DISTRIBUTOR_WALLET = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
    const DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET || process.env.WALDO_DISTRIBUTOR_SEED;
    const ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
    const CURRENCY = process.env.WALDO_CURRENCY || 'WLO';

    console.log('[UNSTAKE] Environment check:', {
      hasDistributorWallet: !!DISTRIBUTOR_WALLET,
      hasDistributorSecret: !!DISTRIBUTOR_SECRET,
      distributorWallet: DISTRIBUTOR_WALLET,
      issuer: ISSUER,
      currency: CURRENCY
    });

    if (!DISTRIBUTOR_SECRET) {
      console.error('[UNSTAKE] Missing distributor secret');
      return res.status(500).json({
        success: false,
        error: "Distributor wallet secret not configured. Please contact admin."
      });
    }

    // Create XUMM payload for unstaking
    console.log(`[UNSTAKE] Creating XUMM payload for ${userReceives} WALDO to ${wallet}`);

    const memoType = Buffer.from('UNSTAKE_EARLY').toString('hex').toUpperCase();
    const memoData = Buffer.from(stakeId).toString('hex').toUpperCase();

    const txjson = {
      TransactionType: 'Payment',
      Account: DISTRIBUTOR_WALLET,
      Destination: wallet,
      Amount: {
        currency: CURRENCY,
        issuer: ISSUER,
        value: userReceives.toString()
      },
      Memos: [{ Memo: { MemoType: memoType, MemoData: memoData } }]
    };

    console.log('[UNSTAKE] Creating XUMM payload...');
    const payload = await xummClient.payload.create(txjson);

    if (!payload || !payload.uuid) {
      console.error('[UNSTAKE] Failed to create XUMM payload');
      return res.status(500).json({
        success: false,
        error: 'Failed to create payment request'
      });
    }

    console.log(`[UNSTAKE] XUMM payload created: ${payload.uuid}`);

    // Store unstake offer data for status checking
    const offerData = {
      wallet,
      stakeId,
      originalAmount: originalAmount.toString(),
      penalty: penalty.toString(),
      userReceives: userReceives.toString(),
      createdAt: new Date().toISOString()
    };

    await redis.hSet(`stake:unstake_offer:${payload.uuid}`, offerData);
    await redis.expire(`stake:unstake_offer:${payload.uuid}`, 300); // 5 minutes

    console.log(`[UNSTAKE] XUMM payload created for ${stakeId}: ${userReceives} WALDO to ${wallet}`);

    return res.json({
      success: true,
      uuid: payload.uuid,
      refs: payload.refs,
      amount: userReceives,
      penalty: penalty,
      message: `Scan QR to unlock ${userReceives.toFixed(2)} WALDO (${penalty.toFixed(2)} WALDO penalty applied)`
    });

  } catch (e) {
    console.error('[UNSTAKE] Auto-unstake error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ GET /api/staking/unstake/status/:uuid - Check unstake transaction status
router.get('/unstake/status/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const { account, txid } = req.query;
    console.log(`[UNSTAKE-STATUS] Checking status for UUID: ${uuid}`);

    if (!uuid) {
      return res.json({ ok: false, error: 'Missing UUID' });
    }

    // Get offer data
    const offerData = await redis.hGetAll(`stake:unstake_offer:${uuid}`);
    console.log(`[UNSTAKE-STATUS] Offer data:`, offerData);
    if (!offerData.stakeId) {
      return res.json({ ok: false, error: 'Offer not found' });
    }

    const processedKey = `stake:unstake_processed:${uuid}`;
    const alreadyProcessed = await redis.get(processedKey);
    if (alreadyProcessed) {
      console.log(`[UNSTAKE-STATUS] Already processed`);
      return res.json({ ok: true, signed: true, account, txid, paid: true });
    }

    // Check XUMM status with timeout
    console.log(`[UNSTAKE-STATUS] Checking XUMM payload...`);
    const payload = await Promise.race([
      xummClient.payload.get(uuid),
      new Promise((_, reject) => setTimeout(() => reject(new Error('XUMM timeout')), 5000))
    ]);

    console.log(`[UNSTAKE-STATUS] XUMM payload response:`, {
      payload: !!payload,
      response: !!payload?.response,
      signed: payload?.response?.signed,
      account: payload?.response?.account,
      dispatched_result: payload?.response?.dispatched_result,
      dispatched_to: payload?.response?.dispatched_to,
      multisign_account: payload?.response?.multisign_account,
      txid: payload?.response?.txid
    });

    if (!payload || !payload.response) {
      console.log(`[UNSTAKE-STATUS] Invalid payload structure`);
      return res.json({ ok: true, signed: false, error: 'Invalid payload response' });
    }

    // Check if transaction was signed (could be true or dispatched_result)
    const isSigned = payload.response.signed === true ||
      payload.response.dispatched_result === 'tesSUCCESS' ||
      (payload.response.txid && payload.response.txid !== '');

    if (!isSigned) {
      console.log(`[UNSTAKE-STATUS] Transaction not signed yet. signed=${payload.response.signed}, dispatched_result=${payload.response.dispatched_result}, txid=${payload.response.txid}`);
      return res.json({ ok: true, signed: false });
    }

    // Get transaction ID from XUMM response
    const actualTxid = payload.response.txid || txid || '';
    console.log(`[UNSTAKE-STATUS] Transaction signed! TXID: ${actualTxid}`);

    // Process the unstaking
    const { stakeId, wallet, originalAmount, penalty, userReceives } = offerData;
    const now = new Date();

    console.log(`[UNSTAKE-STATUS] Processing unstake for stake: ${stakeId}, wallet: ${wallet}`);

    // Check if already processed by looking at stake status
    const currentStakeData = await redis.hGetAll(`staking:${stakeId}`);
    if (currentStakeData.status === 'completed' && currentStakeData.unstakedAt) {
      console.log(`[UNSTAKE-STATUS] Stake already completed, skipping update`);
      // Mark as processed and return success
      await redis.set(processedKey, '1', { EX: 604800 });
      return res.json({ ok: true, signed: true, account, txid: actualTxid, paid: true });
    }

    // Update staking record (only if not already completed)
    await redis.hSet(`staking:${stakeId}`, {
      status: 'completed',
      unstakedAt: now.toISOString(), // Time when moved to "Recently Redeemed"
      processedAt: now.toISOString(), // Time when transferred over to claimed section
      isEarlyUnstake: 'true',
      penalty: penalty,
      userReceives: userReceives,
      claimed: 'true',
      unstakeTx: actualTxid
    });

    console.log(`[UNSTAKE-STATUS] Updated stake record: ${stakeId} -> completed`);

    // Remove from active stake sets
    await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);

    // Add to redeemed set (for "Recently Redeemed" section)
    await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);

    // Update stats
    try {
      const amount = parseFloat(originalAmount || 0);
      const penaltyAmount = parseFloat(penalty || 0);
      if (amount > 0) {
        await redis.incrByFloat('staking:total_staked', -amount);
        await redis.incrByFloat('staking:total_long_term_staked', -amount);
      }
      if (penaltyAmount > 0) {
        await redis.incrByFloat('staking:total_penalties', penaltyAmount);
      }
    } catch (statsError) {
      console.error('❌ Error updating unstake stats:', statsError);
    }

    // Log the action
    await redis.lPush('staking_logs', JSON.stringify({
      action: 'unstake_completed',
      stakeId,
      wallet,
      originalAmount: parseFloat(originalAmount || 0),
      penalty: parseFloat(penalty || 0),
      userReceives: parseFloat(userReceives || 0),
      txid,
      timestamp: now.toISOString()
    }));

    // Mark as processed
    await redis.set(processedKey, '1', { EX: 604800 });
    console.log(`[UNSTAKE-STATUS] Marked as processed: ${processedKey}`);

    return res.json({ ok: true, signed: true, account, txid: actualTxid, paid: true });
  } catch (e) {
    console.error('[UNSTAKE-STATUS] Error:', e.message || e);
    // Return a proper response even on error to prevent 502
    return res.json({ ok: true, signed: false, error: e.message || 'Status check failed' });
  }
});

console.log("🏦 Loaded: routes/staking.js");

// GET /api/staking/positions - Get all staking positions (admin only)
router.get('/positions', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status || 'all'; // all, active, completed, unstaked

    // Get all staking position keys
    const stakingKeys = await redis.keys("staking:*");
    console.log(`🔍 Found ${stakingKeys.length} staking keys:`, stakingKeys.slice(0, 10));
    const positions = [];

    for (const key of stakingKeys) {
      // Skip non-position keys (like staking:total_amount, staking:active_count, etc)
      if (key.includes(':') && !key.includes(':total_') && !key.includes(':active_') && !key.includes(':user:')) {
        const positionData = await redis.hGetAll(key);
        console.log(`📦 Key: ${key}, Data keys:`, Object.keys(positionData));

        if (positionData && Object.keys(positionData).length > 0) {
          // Extract stakeId from key (format: staking:${stakeId})
          const stakeId = key.split(':')[1];
          const walletAddress = positionData.wallet || 'unknown';

          // Calculate current value and time remaining
          const startTime = new Date(positionData.startTime);
          const endTime = new Date(positionData.endTime);
          const now = new Date();

          const timeRemaining = Math.max(0, endTime - now);
          const totalDuration = endTime - startTime;
          const elapsed = now - startTime;
          const progress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;

          // Calculate current rewards as flat bonus (not annualized)
          const baseAmount = parseFloat(positionData.amount) || 0;
          const apy = parseFloat(positionData.apy) || 0;
          const currentRewards = baseAmount * (apy / 100); // Simple percentage bonus

          const position = {
            id: stakeId,
            wallet: walletAddress,
            walletAddress: walletAddress,
            amount: baseAmount,
            tier: positionData.tier || 'unknown',
            apy: apy,
            duration: positionData.duration || 'unknown',
            startTime: positionData.startTime,
            endTime: positionData.endTime,
            unlockDate: positionData.endTime,
            status: positionData.status || 'active',
            progress: progress.toFixed(1),
            timeRemaining: timeRemaining,
            currentRewards: currentRewards.toFixed(2),
            totalValue: (baseAmount + currentRewards).toFixed(2),
            canUnstake: positionData.status === 'active' && timeRemaining <= 0,
            earlyUnstakePenalty: timeRemaining > 0 ? '15%' : '0%'
          };

          // Filter by status if specified
          if (status === 'all' || position.status === status) {
            positions.push(position);
          }
        }
      }
    }

    // Sort by start time (newest first)
    positions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    // Calculate summary stats
    const totalStaked = positions.reduce((sum, pos) => sum + pos.amount, 0);
    const totalRewards = positions.reduce((sum, pos) => sum + parseFloat(pos.currentRewards), 0);
    const activePositions = positions.filter(pos => pos.status === 'active').length;

    console.log(`🏦 Staking positions requested: ${positions.length} positions, ${totalStaked} WALDO staked`);

    return res.json({
      success: true,
      positions: positions.slice(0, limit),
      summary: {
        totalPositions: positions.length,
        activePositions: activePositions,
        totalStaked: totalStaked.toFixed(2),
        totalRewards: totalRewards.toFixed(2),
        averageAPY: positions.length > 0 ? (positions.reduce((sum, pos) => sum + pos.apy, 0) / positions.length).toFixed(2) : 0
      },
      filter: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting staking positions:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking positions"
    });
  }
});

// GET /api/staking/user/:wallet - Get user's staking positions
router.get('/user/:wallet', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet address"
      });
    }

    // Get user's staking positions
    const userStakingKeys = await redis.keys(`staking:${wallet}:position:*`);
    const positions = [];

    for (const key of userStakingKeys) {
      const positionData = await redis.hGetAll(key);

      if (positionData && Object.keys(positionData).length > 0) {
        const positionId = key.split(':')[3];

        // Calculate current status
        const startTime = new Date(positionData.startTime);
        const endTime = new Date(positionData.endTime);
        const now = new Date();

        const timeRemaining = Math.max(0, endTime - now);
        const totalDuration = endTime - startTime;
        const elapsed = now - startTime;
        const progress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;

        // Calculate rewards as flat bonus (not annualized)
        const baseAmount = parseFloat(positionData.amount) || 0;
        const apy = parseFloat(positionData.apy) || 0;
        const currentRewards = baseAmount * (apy / 100); // Simple percentage bonus

        positions.push({
          id: positionId,
          amount: baseAmount,
          tier: positionData.tier || 'unknown',
          apy: apy,
          startTime: positionData.startTime,
          endTime: positionData.endTime,
          status: positionData.status || 'active',
          progress: progress.toFixed(1),
          timeRemaining: timeRemaining,
          currentRewards: currentRewards.toFixed(2),
          totalValue: (baseAmount + currentRewards).toFixed(2),
          canUnstake: positionData.status === 'active' && timeRemaining <= 0,
          earlyUnstakePenalty: timeRemaining > 0 ? '15%' : '0%',
          daysRemaining: timeRemaining <= 0 ? 0 : Math.ceil(timeRemaining / (24 * 60 * 60 * 1000))
        });
      }
    }

    // Sort by start time (newest first)
    positions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const summary = {
      totalPositions: positions.length,
      activePositions: positions.filter(pos => pos.status === 'active').length,
      totalStaked: positions.reduce((sum, pos) => sum + pos.amount, 0).toFixed(2),
      totalRewards: positions.reduce((sum, pos) => sum + parseFloat(pos.currentRewards), 0).toFixed(2),
      canUnstakeCount: positions.filter(pos => pos.canUnstake).length
    };

    console.log(`🏦 User staking positions requested: ${wallet} - ${positions.length} positions`);

    return res.json({
      success: true,
      wallet: wallet,
      positions: positions,
      summary: summary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting user staking positions:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user staking positions"
    });
  }
});

// POST /api/staking/manual-unstake - Manually unstake a position (admin only)
router.post('/manual-unstake', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    const { wallet, positionId, force } = req.body;

    if (!wallet || !positionId) {
      return res.status(400).json({
        success: false,
        error: "Wallet address and position ID required"
      });
    }

    // Check if position exists
    const positionKey = `staking:${wallet}:position:${positionId}`;
    const positionExists = await redis.exists(positionKey);

    if (!positionExists) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found"
      });
    }

    // Get position data
    const positionData = await redis.hGetAll(positionKey);
    const baseAmount = parseFloat(positionData.amount) || 0;
    const endTime = new Date(positionData.endTime);
    const now = new Date();
    const isEarly = now < endTime;

    // Calculate final amount (with penalty if early)
    let finalAmount = baseAmount;
    let penalty = 0;

    if (isEarly && !force) {
      return res.status(400).json({
        success: false,
        error: "Position not yet matured. Use force=true to apply 15% early unstaking penalty",
        timeRemaining: Math.max(0, endTime - now),
        earlyUnstakePenalty: "15%"
      });
    }

    if (isEarly && force) {
      penalty = baseAmount * 0.15; // 15% penalty
      finalAmount = baseAmount - penalty;
    }

    // Calculate rewards as flat bonus (not annualized)
    const apy = parseFloat(positionData.apy) || 0;
    const rewards = baseAmount * (apy / 100); // Simple percentage bonus

    // Update position status
    await redis.hSet(positionKey, {
      status: 'unstaked',
      unstakedAt: now.toISOString(),
      unstakedBy: 'admin',
      finalAmount: finalAmount.toFixed(2),
      penalty: penalty.toFixed(2),
      rewards: rewards.toFixed(2),
      totalReceived: (finalAmount + rewards).toFixed(2)
    });

    // Update global staking counters
    const currentTotalStaked = await redis.get("staking:total_amount") || 0;
    const currentActiveStakers = await redis.get("staking:active_count") || 0;

    await redis.set("staking:total_amount", Math.max(0, parseFloat(currentTotalStaked) - baseAmount));
    await redis.set("staking:active_count", Math.max(0, parseInt(currentActiveStakers) - 1));

    console.log(`🏦 Manual unstake by admin: ${wallet} - Position ${positionId} - Amount: ${finalAmount} WALDO`);

    return res.json({
      success: true,
      message: `Position ${positionId} has been unstaked`,
      unstakeDetails: {
        wallet: wallet,
        positionId: positionId,
        originalAmount: baseAmount,
        penalty: penalty,
        finalAmount: finalAmount,
        rewards: rewards.toFixed(2),
        totalReceived: (finalAmount + rewards).toFixed(2),
        wasEarly: isEarly,
        unstakedBy: 'admin'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error manually unstaking position:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to manually unstake position"
    });
  }
});

// GET /api/staking/stats - Get staking system statistics
router.get('/stats', async (req, res) => {
  try {
    // Get basic staking metrics
    const totalStaked = await redis.get("staking:total_amount") || 0;
    const activeStakers = await redis.get("staking:active_count") || 0;
    const totalUsers = await redis.get("users:total_count") || 0;

    // Get all staking positions for detailed stats
    const stakingKeys = await redis.keys("staking:*:position:*");
    const positionsByTier = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    const positionsByStatus = { active: 0, completed: 0, unstaked: 0 };
    let totalRewards = 0;
    let totalPenalties = 0;

    for (const key of stakingKeys) {
      const positionData = await redis.hGetAll(key);

      if (positionData && Object.keys(positionData).length > 0) {
        const tier = positionData.tier || 'tier1';
        const status = positionData.status || 'active';

        if (positionsByTier.hasOwnProperty(tier)) {
          positionsByTier[tier]++;
        }

        if (positionsByStatus.hasOwnProperty(status)) {
          positionsByStatus[status]++;
        }

        // Add up rewards and penalties
        if (positionData.rewards) {
          totalRewards += parseFloat(positionData.rewards);
        }
        if (positionData.penalty) {
          totalPenalties += parseFloat(positionData.penalty);
        }
      }
    }

    // Calculate participation rate
    const participationRate = totalUsers > 0 ? ((activeStakers / totalUsers) * 100).toFixed(1) : 0;
    const averageStakePerUser = activeStakers > 0 ? (totalStaked / activeStakers).toFixed(2) : 0;

    // Per-meme redemption summary from logs (public-safe aggregate)
    let perMemeRedemptions = { count: 0, totalAmount: 0, last10: [] };
    try {
      const recentLogs = await redis.lRange('staking_logs', 0, 499); // look at most recent 500 events
      const parsed = recentLogs.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const pm = parsed.filter(ev => ev && ev.action === 'per_meme_stake_redeemed');
      const count = pm.length;
      const totalAmount = pm.reduce((s, ev) => s + (Number(ev.amount) || 0), 0);
      const last10 = pm.slice(0, 10).map(ev => ({
        stakeId: ev.stakeId,
        wallet: ev.wallet,
        amount: Number(ev.amount) || 0,
        txid: ev.txid || '',
        timestamp: ev.timestamp || ''
      }));
      perMemeRedemptions = { count, totalAmount: Number(totalAmount.toFixed(6)), last10 };
    } catch (e) {
      // non-fatal
      console.warn('per_meme redemptions summary failed:', e?.message || e);
    }

    const stakingStats = {
      overview: {
        totalStaked: parseFloat(totalStaked).toFixed(2),
        activeStakers: parseInt(activeStakers),
        totalPositions: stakingKeys.length,
        participationRate: `${participationRate}%`,
        averageStakePerUser: parseFloat(averageStakePerUser)
      },
      distribution: {
        byTier: positionsByTier,
        byStatus: positionsByStatus
      },
      rewards: {
        totalRewardsPaid: totalRewards.toFixed(2),
        totalPenaltiesCollected: totalPenalties.toFixed(2),
        netRewards: (totalRewards - totalPenalties).toFixed(2)
      },
      tiers: {
        tier1: { name: "30 Days", apy: "12%", minAmount: 100 },
        tier2: { name: "90 Days", apy: "18%", minAmount: 500 },
        tier3: { name: "180 Days", apy: "25%", minAmount: 1000 },
        tier4: { name: "365 Days", apy: "35%", minAmount: 2500 }
      },
      system: {
        earlyUnstakePenalty: "15%",
        autoRenewal: "enabled",
        lastUpdated: new Date().toISOString()
      },
      perMemeRedemptions
    };

    console.log(`🏦 Staking stats requested: ${totalStaked} WALDO staked by ${activeStakers} users`);

    return res.json({
      success: true,
      stats: stakingStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting staking stats:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking statistics"
    });
  }
});

// POST /api/staking/stake - Create new staking position
router.post('/stake', rateLimitMiddleware('PAYMENT_CREATE', (req) => req.body.wallet), async (req, res) => {
  try {
    const { wallet, amount, duration, tier } = req.body;

    if (!wallet || !amount || !duration) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, duration"
      });
    }

    // No minimum WALDO balance requirement for staking operations
    // Minimum balance checks are only enforced for meme payout claims


    // Validate amount and duration
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        error: "Minimum staking amount is 100 WALDO"
      });
    }

    if (![30, 90, 180, 365].includes(duration)) {
      return res.status(400).json({
        success: false,
        error: "Invalid duration. Must be 30, 90, 180, or 365 days"
      });
    }

    // Create staking position
    const stakeId = `stake_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (duration * 24 * 60 * 60 * 1000));

    // Calculate APY based on duration
    const apyRates = {
      30: 12,   // 12% APY for 30 days
      90: 18,   // 18% APY for 90 days
      180: 25,  // 25% APY for 180 days
      365: 35   // 35% APY for 365 days
    };

    const apy = apyRates[duration];
    const expectedReward = Math.floor((amount * apy / 100) * (duration / 365));

    const stakeData = {
      stakeId,
      wallet,
      amount: parseInt(amount),
      duration,
      tier: tier || 1,
      apy,
      expectedReward,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      createdAt: new Date().toISOString()
    };

    // Store staking position
    await redis.hSet(`staking:${stakeId}`, stakeData);
    await redis.sAdd(`staking:user:${wallet}`, stakeId);
    await redis.sAdd('staking:active', stakeId);

    // Update user stats
    await redis.hIncrBy(`user:${wallet}`, 'totalStaked', amount);
    await redis.hIncrBy(`user:${wallet}`, 'activeStakes', 1);

    // Update global stats
    await redis.incrBy('staking:total_staked', amount);
    await redis.incr('staking:total_positions');

    console.log(`🏦 Staking position created: ${wallet} staked ${amount} WALDO for ${duration} days`);

    return res.json({
      success: true,
      message: `Successfully staked ${amount} WALDO for ${duration} days!`,
      stakeId,
      expectedReward,
      apy,
      endDate: endDate.toISOString()
    });

  } catch (error) {
    console.error('❌ Staking error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create staking position"
    });
  }
});

// GET /api/staking/positions/:wallet - Get user's staking positions (aggregate across schemas)
router.get('/positions/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    const positions = [];
    const seen = new Set();

    // Schema B (generic): staking:user:{wallet}
    const genericIds = await redis.sMembers(`staking:user:${wallet}`);
    for (const stakeId of genericIds) {
      try {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);
        if (stakeData && Object.keys(stakeData).length > 0) {
          positions.push({
            stakeId: stakeData.stakeId,
            amount: parseInt(stakeData.amount),
            duration: parseInt(stakeData.duration),
            apy: parseFloat(stakeData.apy),
            expectedReward: parseInt(stakeData.expectedReward || 0),
            startDate: stakeData.startDate,
            endDate: stakeData.endDate,
            status: stakeData.status,
            daysRemaining: (() => {
              const timeLeft = new Date(stakeData.endDate) - new Date();
              return timeLeft <= 0 ? 0 : Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            })()
          });
          seen.add(stakeId);
        }
      } catch (e) { /* ignore individual errors */ }
    }

    // Schema A (long-term set): user:{wallet}:long_term_stakes
    const ltIds = await redis.sMembers(`user:${wallet}:long_term_stakes`);
    for (const stakeId of ltIds) {
      if (seen.has(stakeId)) continue;
      try {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);
        if (stakeData && Object.keys(stakeData).length > 0) {
          positions.push({
            stakeId: stakeData.stakeId,
            amount: parseInt(stakeData.amount),
            duration: parseInt(stakeData.duration),
            apy: parseFloat(stakeData.apy),
            expectedReward: parseInt(stakeData.expectedReward || 0),
            startDate: stakeData.startDate,
            endDate: stakeData.endDate,
            status: stakeData.status,
            daysRemaining: (() => {
              const timeLeft = new Date(stakeData.endDate) - new Date();
              return timeLeft <= 0 ? 0 : Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            })()
          });
          seen.add(stakeId);
        }
      } catch (e) { /* ignore individual errors */ }
    }

    // Schema C (redeemed stakes): staking:user:{wallet}:redeemed
    try {
      const redeemedIds = await redis.sMembers(`staking:user:${wallet}:redeemed`);
      for (const stakeId of redeemedIds) {
        if (seen.has(stakeId)) continue;
        try {
          const stakeData = await redis.hGetAll(`staking:${stakeId}`);
          if (stakeData && Object.keys(stakeData).length > 0) {
            positions.push({
              stakeId: stakeData.stakeId || stakeId,
              amount: parseInt(stakeData.amount || 0),
              duration: parseInt(stakeData.duration || 30),
              apy: parseFloat(stakeData.apy || 12),
              expectedReward: parseInt(stakeData.expectedReward || 0),
              startDate: stakeData.startDate || new Date().toISOString(),
              endDate: stakeData.endDate || new Date().toISOString(),
              status: stakeData.status || 'redeemed',
              redeemedAt: stakeData.redeemedAt || new Date().toISOString(),
              redeemTx: stakeData.redeemTx || '',
              totalReceived: parseFloat(stakeData.totalReceived || stakeData.amount || 0),
              originalAmount: parseFloat(stakeData.originalAmount || stakeData.amount || 0),
              rewardAmount: parseFloat(stakeData.rewardAmount || stakeData.expectedReward || 0),
              daysRemaining: 0 // Already redeemed
            });
            seen.add(stakeId);
          }
        } catch (e) {
          console.log(`Warning: Failed to load redeemed stake ${stakeId}:`, e.message);
        }
      }
    } catch (e) {
      console.log('Warning: Failed to load redeemed stakes:', e.message);
    }

    // Debug logging for positions endpoint
    const statusCounts = positions.reduce((acc, pos) => {
      acc[pos.status] = (acc[pos.status] || 0) + 1;
      return acc;
    }, {});
    console.log(`[POSITIONS] Wallet ${wallet} - Status counts:`, statusCounts);
    console.log(`[POSITIONS] Returning ${positions.length} total positions`);

    return res.json({
      success: true,
      positions,
      totalPositions: positions.length,
      totalStaked: positions.reduce((sum, pos) => sum + (pos.status === 'redeemed' ? 0 : pos.amount), 0)
    });

  } catch (error) {
    console.error('❌ Get positions error:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to get staking positions"
    });
  }
});



// ✅ GET /api/staking/admin/overview - Admin staking overview
router.get("/admin/overview", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    // Verify admin access
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized access" });
    }

    // Get staking totals
    const totalStaked = await redis.get('staking:total_staked') || 0;
    const totalStakes = await redis.get('staking:total_stakes') || 0;
    const totalBurned = await redis.get('staking:total_burned') || 0;
    const totalTreasury = await redis.get('staking:total_treasury') || 0;
    const totalPenalties = await redis.get('staking:total_penalties') || 0;

    // Get recent staking logs
    const recentLogs = await redis.lRange('staking_logs', 0, 19); // Last 20 logs
    const parsedLogs = recentLogs.map(log => {
      try {
        return JSON.parse(log);
      } catch (error) {
        return null;
      }
    }).filter(log => log !== null);

    // Get active stakes by level
    const stakesByLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const allStakeKeys = await redis.keys('staking:stake_*');

    for (const key of allStakeKeys) {
      try {
        const stakeData = await redis.hGetAll(key);
        if (stakeData.status === 'active' && stakeData.userLevel) {
          const level = parseInt(stakeData.userLevel);
          if (level >= 1 && level <= 5) {
            stakesByLevel[level]++;
          }
        }
      } catch (error) {
        console.error(`Error processing stake ${key}:`, error);
      }
    }

    res.json({
      success: true,
      overview: {
        totalStaked: parseFloat(totalStaked),
        totalStakes: parseInt(totalStakes),
        totalBurned: parseFloat(totalBurned),
        totalTreasury: parseFloat(totalTreasury),
        totalPenalties: parseFloat(totalPenalties),
        activeStakesByLevel: stakesByLevel
      },
      levelBonuses: Object.entries(LEVEL_STAKING_BONUSES).map(([level, bonus]) => ({
        level: parseInt(level),
        title: XP_LEVELS[level].title,
        bonus: `${(bonus * 100).toFixed(2)}%`
      })),
      recentActivity: parsedLogs
    });

  } catch (error) {
    console.error('❌ Error getting staking overview:', error);
    res.status(500).json({
      success: false,
      error: "Failed to get staking overview"
    });
  }
});

// ✅ POST /api/staking/redeem — initiate redeem (user signs in Xaman to trigger payout)
router.post('/redeem', async (req, res) => {
  try {
    const { wallet, stakeId } = req.body;
    if (!wallet || !stakeId) {
      return res.status(400).json({ success: false, error: 'Missing wallet or stakeId' });
    }
    const stakeKey = `staking:${stakeId}`;
    const stakeData = await redis.hGetAll(stakeKey);
    if (!stakeData || !stakeData.wallet) {
      return res.status(404).json({ success: false, error: 'Stake not found' });
    }
    if (stakeData.wallet !== wallet) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    if (stakeData.status !== 'active') {
      // If stake is already completed but still in active sets, clean up the sets
      if (stakeData.status === 'completed' || stakeData.status === 'redeemed') {
        console.log(`[REDEEM] Cleaning up sets for already processed stake: ${stakeId}`);
        await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
        await redis.sRem(`staking:user:${wallet}`, stakeId);
        await redis.sRem('staking:active', stakeId);
        await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);
      }

      if (stakeData.status === 'redeemed') {
        return res.status(400).json({ success: false, error: 'Stake already redeemed' });
      } else if (stakeData.status === 'completed') {
        return res.status(400).json({ success: false, error: 'Stake already unlocked early' });
      } else {
        return res.status(400).json({ success: false, error: 'Stake not active' });
      }
    }
    const now = Date.now();
    const end = new Date(stakeData.endDate).getTime();
    const timeRemaining = end - now;

    console.log(`[REDEEM] Maturity check for stake ${stakeId}:`);
    console.log(`[REDEEM] Current time: ${new Date(now).toISOString()}`);
    console.log(`[REDEEM] End time: ${new Date(end).toISOString()}`);
    console.log(`[REDEEM] Time remaining: ${timeRemaining}ms (${Math.ceil(timeRemaining / (1000 * 60 * 60 * 24))} days)`);

    // Add 60-second buffer to account for timing differences between frontend countdown and backend check
    const bufferMs = 60 * 1000; // 60 seconds (increased from 30s)
    if (now < (end - bufferMs)) {
      console.log(`[REDEEM] Stake not yet matured - ${timeRemaining}ms remaining (with ${bufferMs}ms buffer)`);
      console.log(`[REDEEM] Frontend might show READY but backend needs ${Math.ceil((end - bufferMs - now) / 1000)}s more`);
      return res.status(400).json({ success: false, error: 'Stake not yet matured' });
    }

    console.log(`[REDEEM] Stake is mature - proceeding with redemption`);

    const type = stakeData.type || 'long_term';

    // Calculate total amount to receive (stake + rewards)
    const originalAmount = parseFloat(stakeData.amount || 0);
    const expectedReward = parseFloat(stakeData.expectedReward || 0);
    const totalAmount = originalAmount + expectedReward;

    // Get distributor wallet address (from constants)
    const CURRENCY = process.env.WALDO_CURRENCY || 'WLO';

    // Check distributor wallet balance before creating transaction
    try {
      const distributorBalance = await getWaldoBalance(DISTRIBUTOR_WALLET);
      console.log(`[REDEEM] Distributor balance: ${distributorBalance} WALDO, need: ${totalAmount} WALDO`);

      if (distributorBalance < totalAmount) {
        return res.status(500).json({
          success: false,
          error: `Insufficient distributor balance. Need ${totalAmount.toFixed(2)} WALDO but only have ${distributorBalance.toFixed(2)} WALDO. Please contact admin.`
        });
      }
    } catch (e) {
      console.warn('[REDEEM] Could not check distributor balance:', e.message);
      // Continue anyway - let XUMM handle the error
    }

    // Create XUMM Payment transaction (user signs to receive their WALDO)
    const memoType = Buffer.from(type === 'per_meme' ? 'REDEEM_MEME' : 'REDEEM_LONG').toString('hex').toUpperCase();
    const memoData = Buffer.from(stakeId).toString('hex').toUpperCase();

    const txjson = {
      TransactionType: 'Payment',
      Account: DISTRIBUTOR_WALLET,
      Destination: wallet,
      Amount: {
        currency: CURRENCY,
        issuer: ISSUER,
        value: totalAmount.toString()
      },
      Memos: [{ Memo: { MemoType: memoType, MemoData: memoData } }]
    };

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 900, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: {
        identifier: `WALDO_STAKE_REDEEM_${type.toUpperCase()}`,
        instruction: `Redeem ${totalAmount.toFixed(2)} WALDO (${originalAmount} stake + ${expectedReward.toFixed(2)} rewards)`
      }
    });

    // Map for status processing
    await redis.hSet(`stake:redeem_offer:${created.uuid}`, { stakeId, wallet, type });

    // Schedule automatic processing after 20 seconds (fallback for when status polling is disabled)
    setTimeout(async () => {
      try {
        console.log(`[REDEEM-FALLBACK] Checking redemption status for ${created.uuid} after 20 seconds...`);
        await processRedemptionIfComplete(created.uuid);
      } catch (error) {
        console.log(`[REDEEM-FALLBACK] Auto-check failed:`, error.message);
      }
    }, 20000);

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (e) {
    console.error('redeem init error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ✅ GET /api/staking/redeem/status/:uuid — check if Payment transaction was successful
router.get('/redeem/status/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    if (!uuid) return res.status(400).json({ ok: false, error: 'missing uuid' });

    const p = await xummClient.payload.get(uuid).catch(() => null);
    if (!p) return res.json({ ok: true, found: false });

    const signed = !!p?.meta?.signed;
    const account = p?.response?.account || null;
    const txid = p?.response?.txid || null;
    if (!signed) return res.json({ ok: true, signed: false, account: null });

    // Check if Payment transaction was successful
    const paymentSuccessful = p?.response?.dispatched_result === 'tesSUCCESS';
    if (!paymentSuccessful) {
      return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'payment_failed' });
    }

    // Check if already processed to prevent duplicate redemptions
    const processedKey = `stake:redeem_processed:${uuid}`;
    const alreadyProcessed = await redis.get(processedKey);
    if (alreadyProcessed) {
      console.log(`[REDEEM-STATUS] Already processed redemption: ${uuid}`);
      return res.json({ ok: true, signed: true, account, txid, paid: true });
    }

    // Get stake info and mark as completed
    const offer = await redis.hGetAll(`stake:redeem_offer:${uuid}`);
    const stakeId = offer?.stakeId;
    const wallet = offer?.wallet;
    const type = offer?.type || 'long_term';
    if (!stakeId || !wallet) return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'stake_not_found' });

    const stakeKey = `staking:${stakeId}`;
    const stakeData = await redis.hGetAll(stakeKey);
    if (!stakeData) return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'stake_data_missing' });

    // Check if already processed by looking at stake status
    if (stakeData.status === 'redeemed' && stakeData.redeemedAt) {
      console.log(`[REDEEM-STATUS] Stake already redeemed, skipping update`);
      return res.json({ ok: true, signed: true, account, txid, paid: true });
    }

    // Mark stake as completed since Payment was successful
    const redeemedAt = new Date().toISOString();
    const originalAmount = parseFloat(stakeData.amount || 0);
    const expectedReward = parseFloat(stakeData.expectedReward || 0);
    const totalAmount = originalAmount + expectedReward;

    await redis.hSet(stakeKey, {
      status: 'redeemed',
      redeemedAt: redeemedAt, // Time when moved to "Recently Redeemed"
      processedAt: redeemedAt, // Time when transferred over to claimed section
      redeemTx: txid || '',
      claimed: 'true',
      totalReceived: totalAmount.toString(),
      originalAmount: originalAmount.toString(),
      rewardAmount: expectedReward.toString()
    });

    // Remove from active sets
    await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);

    // Add to redeemed set (simple approach - no expiry for now)
    await redis.sAdd(`staking:user:${wallet}:redeemed`, stakeId);
    console.log(`[REDEEM-STATUS] Added stake ${stakeId} to redeemed set for wallet ${wallet}`);

    // Verify it was added
    const redeemedCount = await redis.sCard(`staking:user:${wallet}:redeemed`);
    const redeemedList = await redis.sMembers(`staking:user:${wallet}:redeemed`);
    console.log(`[REDEEM-STATUS] Wallet ${wallet} now has ${redeemedCount} redeemed stakes:`, redeemedList);
    console.log(`[REDEEM-STATUS] Stake ${stakeId} status is now: ${stakeData.status} -> redeemed`);

    // Update stats
    const amt = Number(stakeData.amount || 0);
    if (Number.isFinite(amt) && amt > 0) {
      try { await redis.incrByFloat('staking:total_staked', -amt); } catch (_) { }
      try { await redis.incrByFloat('staking:total_long_term_staked', -amt); } catch (_) { }
    }

    // Mark as processed to prevent duplicate redemptions
    await redis.set(processedKey, '1', { EX: 604800 }); // 7 days expiry

    // Clean up offer
    await redis.del(`stake:redeem_offer:${uuid}`);

    console.log(`✅ Stake redeemed: ${wallet} received ${totalAmount.toFixed(2)} WALDO (${stakeId})`);
    return res.json({
      ok: true,
      signed: true,
      account,
      txid,
      paid: true,
      amount: totalAmount.toFixed(2),
      originalAmount: originalAmount.toFixed(2),
      rewardAmount: expectedReward.toFixed(2),
      redeemedAt: redeemedAt
    });

  } catch (e) {
    console.error('redeem status error', e);
    return res.json({ ok: true, signed: false, error: e.message });
  }
});



// Admin: Create test stake (flexible - can be mature or maturing)
router.post('/admin/create-test-stake', async (req, res) => {
  try {
    const adminKey = getAdminKey(req);
    const validation = validateAdminKey(adminKey);

    if (!validation.valid) {
      return res.status(403).json({ success: false, error: validation.error });
    }

    const {
      wallet,
      amount = 1000,
      minutesToMaturity = 2,
      isAlreadyMature = false,
      duration = 30
    } = req.body;

    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet required' });
    }

    const apy = calculateStakeAPY(duration, 1); // Default to level 1 for test stakes
    const expectedReward = calculateExpectedReward(amount, apy);

    let startDate, endDate, stakeId;

    if (isAlreadyMature) {
      // Create already mature stake
      stakeId = createStakeId('longterm', wallet, 'TEST_MATURE');
      startDate = new Date(Date.now() - (35 * 24 * 60 * 60 * 1000)); // 35 days ago
      endDate = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));   // 5 days ago (mature!)
      console.log(`[ADMIN] Creating mature test stake: ${amount} WALDO (already mature)`);
    } else {
      // Create stake that matures in X minutes
      stakeId = createStakeId('test', wallet);
      startDate = new Date();
      endDate = new Date(Date.now() + (minutesToMaturity * 60 * 1000));
      console.log(`[ADMIN] Creating test stake: ${amount} WALDO, matures in ${minutesToMaturity} minutes`);
    }

    // Create stake data directly to avoid utility function date conflicts
    const stakeData = {
      stakeId,
      wallet,
      amount: amount.toString(),
      duration: duration.toString(),
      apy: apy.toString(),
      expectedReward: expectedReward.toString(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      type: 'long_term',
      createdAt: startDate.toISOString(),
      claimed: 'false',
      isTestData: 'true'
    };

    // Store staking position
    await redis.hSet(`staking:${stakeId}`, stakeData);
    await addToActiveSets(wallet, stakeId);

    const maturityStatus = isAlreadyMature ? 'already mature' : `matures in ${minutesToMaturity} minutes`;
    return res.json({
      success: true,
      message: `Test stake created: ${amount} WALDO (${maturityStatus})`,
      stakeId,
      maturesAt: endDate.toISOString(),
      expectedReward
    });

  } catch (error) {
    console.error('[ADMIN] Test stake creation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Clean up inconsistent stake sets
router.post('/admin/cleanup-sets', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const { wallet } = req.body;
    console.log(`[ADMIN] Cleaning up stake sets for wallet: ${wallet || 'ALL'}`);

    let cleaned = 0;
    let wallets = [];

    if (wallet) {
      wallets = [wallet];
    } else {
      // Get all wallets with stakes
      const allStakeKeys = await redis.keys('staking:user:*');
      wallets = allStakeKeys.map(key => key.replace('staking:user:', ''));
    }

    for (const w of wallets) {
      const activeIds = await redis.sMembers(`staking:user:${w}`);

      for (const stakeId of activeIds) {
        const stakeData = await redis.hGetAll(`staking:${stakeId}`);

        if (stakeData.status === 'completed' || stakeData.status === 'redeemed') {
          console.log(`[ADMIN] Moving completed stake ${stakeId} from active to redeemed`);
          await redis.sRem(`user:${w}:long_term_stakes`, stakeId);
          await redis.sRem(`staking:user:${w}`, stakeId);
          await redis.sRem('staking:active', stakeId);
          await redis.sAdd(`staking:user:${w}:redeemed`, stakeId);
          cleaned++;
        }
      }
    }

    return res.json({
      success: true,
      message: `Cleaned up ${cleaned} inconsistent stakes`,
      cleaned
    });

  } catch (error) {
    console.error('[ADMIN] Cleanup error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Force process pending redemptions
router.post('/admin/process-redemptions', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const { wallet } = req.body;
    console.log(`[ADMIN] Force processing redemptions for wallet: ${wallet || 'ALL'}`);

    // Get all redemption offers
    const offerKeys = await redis.keys('stake:redeem_offer:*');
    const processed = [];
    const failed = [];

    for (const offerKey of offerKeys) {
      try {
        const uuid = offerKey.replace('stake:redeem_offer:', '');
        const offer = await redis.hGetAll(offerKey);

        // Skip if wallet filter specified and doesn't match
        if (wallet && offer.wallet !== wallet) continue;

        console.log(`[ADMIN] Processing redemption: ${uuid} for wallet: ${offer.wallet}`);
        const result = await processRedemptionIfComplete(uuid);

        if (result) {
          processed.push({ uuid, wallet: offer.wallet, stakeId: offer.stakeId });
        } else {
          failed.push({ uuid, wallet: offer.wallet, stakeId: offer.stakeId, reason: 'Not complete or already processed' });
        }
      } catch (error) {
        failed.push({ uuid: offerKey, error: error.message });
      }
    }

    return res.json({
      success: true,
      message: `Processed ${processed.length} redemptions, ${failed.length} failed`,
      processed,
      failed
    });

  } catch (error) {
    console.error('[ADMIN] Process redemptions error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: clear fake/failed long-term stakes for a wallet
router.post('/admin/clear-fake', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    const { wallet, max = 50 } = req.body || {};
    if (!wallet || typeof wallet !== 'string' || !wallet.startsWith('r')) {
      return res.status(400).json({ success: false, error: 'Invalid wallet' });
    }

    const idsA = await redis.sMembers(`user:${wallet}:long_term_stakes`);
    const idsB = await redis.sMembers(`staking:user:${wallet}`);
    const ids = Array.from(new Set([...(idsA || []), ...(idsB || [])]));

    const cleared = [];
    for (const id of ids) {
      const key = `staking:${id}`;
      const data = await redis.hGetAll(key);
      if (!data || Object.keys(data).length === 0) {
        await redis.sRem(`user:${wallet}:long_term_stakes`, id);
        await redis.sRem(`staking:user:${wallet}`, id);
        await redis.sRem('staking:active', id);
        continue;
      }
      const type = data.type || 'long_term';
      const status = data.status;
      if (type !== 'long_term') continue;
      if (status === 'active' || status === 'pending_signature') {
        const amt = Number(data.amount || 0);
        if (status === 'active' && Number.isFinite(amt) && amt > 0) {
          try { await redis.incrByFloat('staking:total_staked', -amt); } catch (_) { }
          try { await redis.incrByFloat('staking:total_long_term_staked', -amt); } catch (_) { }
        }
        await redis.hSet(key, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: 'admin' });
        await redis.sRem(`user:${wallet}:long_term_stakes`, id);
        await redis.sRem(`staking:user:${wallet}`, id);
        await redis.sRem('staking:active', id);
        cleared.push(id);
      }
    }

    return res.json({ success: true, wallet, clearedCount: cleared.length, cleared });
  } catch (e) {
    console.error('clear-fake error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/staking/status/:uuid — confirm signature & activate stake (long-term & per-meme)
router.get('/status/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    if (!uuid) return res.status(400).json({ ok: false, error: 'missing uuid' });

    const p = await xummClient.payload.get(uuid).catch(() => null);
    if (!p) return res.json({ ok: true, found: false });

    const signed = !!p?.meta?.signed;
    const account = p?.response?.account || null;
    const txid = p?.response?.txid || null;
    if (!signed) return res.json({ ok: true, signed: false, account: null });

    const processedKey = `stake:processed:${uuid}`;
    const processed = await redis.get(processedKey);
    if (processed) return res.json({ ok: true, signed: true, account, txid, activated: true });

    // Load the stake mapping
    const offer = await redis.hGetAll(`stake:offer:${uuid}`);
    const stakeId = offer?.stakeId;
    if (!stakeId) return res.json({ ok: true, signed: true, account, txid, activated: false, error: 'stake_not_found' });

    const stakeKey = `staking:${stakeId}`;
    const stakeData = await redis.hGetAll(stakeKey);
    if (!stakeData) return res.json({ ok: true, signed: true, account, txid, activated: false, error: 'stake_data_missing' });

    // Mark active + record signature
    await redis.hSet(stakeKey, {
      status: 'active',
      signedAt: new Date().toISOString(),
      signer: account || '',
      fundingTx: txid || ''
    });

    // Update global totals now that funds are locked on-ledger
    const type = stakeData.type || offer?.type || 'long_term';
    if (type === 'per_meme') {
      const stakedAmount = Number(stakeData?.stakedAmount || 0);
      if (Number.isFinite(stakedAmount) && stakedAmount > 0) {
        await redis.incrByFloat('staking:total_per_meme_staked', stakedAmount);
        await redis.incr('staking:total_per_meme_stakes');
      }
      await redis.lPush('staking_logs', JSON.stringify({
        action: 'per_meme_stake_activated', stakeId, wallet: stakeData.wallet, memeId: stakeData.memeId,
        stakedAmount, txid, timestamp: new Date().toISOString()


      }));
    } else {
      const amount = Number(offer?.amount || stakeData?.amount || 0);
      if (Number.isFinite(amount) && amount > 0) {
        await redis.incrByFloat('staking:total_long_term_staked', amount);
        await redis.incr('staking:total_long_term_stakes');
      }
      await redis.lPush('staking_logs', JSON.stringify({
        action: 'long_term_stake_activated', stakeId, wallet: stakeData.wallet, amount,
        duration: stakeData.duration, txid, timestamp: new Date().toISOString()
      }));
    }

    await redis.set(processedKey, '1', { EX: 604800 });

    return res.json({ ok: true, signed: true, account, txid, activated: true });
  } catch (e) {
    console.error('staking status error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// 🧪 POST /api/staking/create-test-mature - Create test mature stake
router.post('/create-test-mature', async (req, res) => {
  try {
    const adminKey = getAdminKey(req);
    const validation = validateAdminKey(adminKey);

    if (!validation.valid) {
      return res.status(403).json({ success: false, error: validation.error });
    }

    const { wallet, amount = 1000, duration = 30 } = req.body;

    if (!wallet) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required"
      });
    }

    // Create test mature stake
    const stakeId = createStakeId('longterm', wallet, 'TEST_MATURE');
    const apy = calculateStakeAPY(duration, 1); // Default to level 1 for test stakes
    const expectedReward = calculateExpectedReward(amount, apy);

    // Set dates so stake is already mature (5 days overdue)
    const startDate = new Date(Date.now() - (35 * 24 * 60 * 60 * 1000)); // 35 days ago
    const endDate = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));   // 5 days ago (mature!)

    const stakeData = {
      stakeId,
      wallet,
      amount: amount.toString(),
      duration: duration.toString(),
      apy: apy.toString(),
      expectedReward: expectedReward.toString(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      type: 'long_term',
      createdAt: startDate.toISOString(),
      isTestData: 'true'
    };

    // Store staking position
    await redis.hSet(`staking:${stakeId}`, stakeData);
    await addToActiveSets(wallet, stakeId);

    console.log(`🧪 Test mature stake created: ${stakeId} for ${wallet}`);

    return res.json({
      success: true,
      message: `Test mature stake created successfully!`,
      testStake: {
        stakeId,
        amount,
        duration,
        apy,
        expectedReward,
        totalRedemption: amount + expectedReward,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        daysOverdue: Math.floor((Date.now() - endDate.getTime()) / (24 * 60 * 60 * 1000))
      }
    });

  } catch (error) {
    console.error('❌ Error creating test mature stake:', error);
    return res.status(500).json({
      success: false,
      error: "Failed to create test mature stake"
    });
  }
});

// 📋 POST /api/staking/mark-viewed - Mark stake as viewed by user
router.post('/mark-viewed', async (req, res) => {
  try {
    const { wallet, stakeId } = req.body;

    if (!wallet || !stakeId) {
      return res.status(400).json({
        success: false,
        error: 'Wallet and stakeId required'
      });
    }

    // Store the viewed timestamp
    const viewedKey = `stake:viewed:${wallet}:${stakeId}`;
    const viewedAt = new Date().toISOString();

    await redis.set(viewedKey, viewedAt, { EX: 60 * 60 * 24 * 30 }); // 30 days expiry

    console.log(`[MARK-VIEWED] Stake ${stakeId} marked as viewed by ${wallet} at ${viewedAt}`);

    return res.json({
      success: true,
      message: 'Stake marked as viewed',
      viewedAt
    });

  } catch (error) {
    console.error('[MARK-VIEWED] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to mark stake as viewed'
    });
  }
});

// 📋 GET /api/staking/viewed-status/:wallet/:stakeId - Check if stake has been viewed
router.get('/viewed-status/:wallet/:stakeId', async (req, res) => {
  try {
    const { wallet, stakeId } = req.params;
    const viewedKey = `stake:viewed:${wallet}:${stakeId}`;
    const viewedAt = await redis.get(viewedKey);

    return res.json({
      success: true,
      viewed: !!viewedAt,
      viewedAt: viewedAt || null
    });

  } catch (error) {
    console.error('[VIEWED-STATUS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check viewed status'
    });
  }
});

// 🧪 DEBUG: Create test stake without admin auth (for testing only)
router.post('/debug/create-test-stake', async (req, res) => {
  try {
    const { wallet, minutesToMaturity = 2, amount = 1000 } = req.body;

    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet required' });
    }

    const stakeId = `debug_${wallet}_${Date.now()}`;
    const startDate = new Date();
    const endDate = new Date(Date.now() + (minutesToMaturity * 60 * 1000));
    const apy = 12;
    const expectedReward = Math.floor((amount * apy / 100) * 100) / 100;

    const stakeData = {
      stakeId,
      wallet,
      amount: amount.toString(),
      duration: '30',
      apy: apy.toString(),
      expectedReward: expectedReward.toString(),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      status: 'active',
      type: 'long_term',
      createdAt: startDate.toISOString(),
      claimed: 'false',
      isTestData: 'true'
    };

    await redis.hSet(`staking:${stakeId}`, stakeData);
    await redis.sAdd(`staking:user:${wallet}`, stakeId);
    await redis.sAdd('staking:active', stakeId);

    console.log(`🧪 DEBUG: Test stake created: ${stakeId}, matures in ${minutesToMaturity} minutes`);

    return res.json({
      success: true,
      message: `Debug test stake created: ${amount} WALDO, matures in ${minutesToMaturity} minutes`,
      stakeId,
      maturesAt: endDate.toISOString(),
      expectedReward,
      debugInfo: {
        now: new Date().toISOString(),
        endDate: endDate.toISOString(),
        minutesToMaturity,
        millisecondsToMaturity: minutesToMaturity * 60 * 1000
      }
    });

  } catch (error) {
    console.error('[DEBUG] Test stake creation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 🔧 POST /api/staking/fix-old-timestamps - Add timestamps to old stakes without them
router.post('/fix-old-timestamps', async (req, res) => {
  try {
    const adminKey = getAdminKey(req);
    const validation = validateAdminKey(adminKey);

    if (!validation.valid) {
      return res.status(403).json({ success: false, error: validation.error });
    }

    const { wallet } = req.body;
    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet required' });
    }

    console.log(`[FIX-TIMESTAMPS] Checking stakes for wallet: ${wallet}`);

    // Get all redeemed stakes for this wallet
    const redeemedStakeIds = await redis.sMembers(`staking:user:${wallet}:redeemed`);
    let fixedCount = 0;

    for (const stakeId of redeemedStakeIds) {
      const stakeData = await redis.hGetAll(`staking:${stakeId}`);

      if (stakeData && (stakeData.status === 'completed' || stakeData.status === 'redeemed')) {
        const hasTimestamp = stakeData.unstakedAt || stakeData.redeemedAt || stakeData.processedAt || stakeData.completedAt;

        if (!hasTimestamp) {
          // Add a timestamp from 1 hour ago so it won't show as NEW
          const oldTimestamp = new Date(Date.now() - (60 * 60 * 1000)).toISOString(); // 1 hour ago

          const updateData = {
            processedAt: oldTimestamp
          };

          // Add appropriate completion timestamp based on type
          if (stakeData.isEarlyUnstake === 'true') {
            updateData.unstakedAt = oldTimestamp;
          } else {
            updateData.redeemedAt = oldTimestamp;
          }

          await redis.hSet(`staking:${stakeId}`, updateData);
          fixedCount++;

          console.log(`[FIX-TIMESTAMPS] Added timestamps to stake ${stakeId}`);
        }
      }
    }

    return res.json({
      success: true,
      message: `Fixed timestamps for ${fixedCount} old stakes`,
      wallet,
      fixedCount
    });

  } catch (error) {
    console.error('[FIX-TIMESTAMPS] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fix timestamps'
    });
  }
});

export default router;
