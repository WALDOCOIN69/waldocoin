import express from 'express';
import { redis } from '../redisClient.js';
import getWaldoBalance from '../utils/getWaldoBalance.js';
import ensureMinWaldoWorth from '../utils/waldoWorth.js';
import { xummClient } from '../utils/xummClient.js';
import xrpl from 'xrpl';

const ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || 'WLO').toUpperCase();
// Prefer dedicated staking vault or Treasury; only fall back to distributor if no vault/treasury configured
const STAKING_VAULT = process.env.WALDO_STAKING_VAULT || process.env.WALDO_TREASURY_WALLET || process.env.TREASURY_WALLET || process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET || 'rnWfL48YCknW6PYewFLKfMKUymHCfj3aww';

// ✅ DUAL STAKING SYSTEM CONFIGURATION

// XP level thresholds (using xpManager.js structure)
const XP_LEVELS = {
  1: { min: 0, max: 999, title: "Waldo Watcher" },
  2: { min: 1000, max: 2999, title: "Waldo Scout" },
  3: { min: 3000, max: 6999, title: "Waldo Agent" },
  4: { min: 7000, max: 14999, title: "Waldo Commander" },
  5: { min: 15000, max: Infinity, title: "Waldo Legend" }
};

// Long-term staking APY rates by duration (progressive rewards for longer commitment)
const LONG_TERM_APY_RATES = {
  30: 8,    // 8% APY for 30 days (lowest rate)
  90: 15,   // 15% APY for 90 days
  180: 25,  // 25% APY for 180 days
  365: 40   // 40% APY for 365 days (highest rate - rewards long-term commitment)
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


// Calculate user's XP level
function getUserLevel(xp) {
  for (const [level, data] of Object.entries(XP_LEVELS)) {
    if (xp >= data.min && xp <= data.max) {
      return {
        level: parseInt(level),
        title: data.title,
        xp: xp,
        availableDurations: LEVEL_DURATION_ACCESS[parseInt(level)]
      };
    }
  }
  return { level: 1, title: "Waldo Watcher", xp: 0, availableDurations: LEVEL_DURATION_ACCESS[1] };
}

// Calculate APY with Level 5 bonus
function calculateAPY(duration, userLevel) {
  const baseAPY = LONG_TERM_APY_RATES[duration];
  // No await here; config is refreshed elsewhere
  if (userLevel === 5) {
    return baseAPY + (LEGEND_BONUS * 100); // Add 2% for Level 5
  }
  return baseAPY;
}

const router = express.Router();

// ✅ POST /api/staking/long-term - Create long-term staking position
router.post("/long-term", async (req, res) => {
  try {
    const { wallet, amount, duration } = req.body;

    if (!wallet || amount == null || duration == null) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, duration"
      });
    }

    console.log('[LT] Incoming request', { wallet, amount, duration });
    // No global WALDO-worth requirement for long‑term staking; per‑meme staking retains worth checks.

    // Validate amount
    const stakeAmount = parseFloat(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount < LONG_TERM_CONFIG.minimumAmount) {
      return res.status(400).json({
        success: false,
        error: `Minimum stake amount is ${LONG_TERM_CONFIG.minimumAmount} WALDO`
      });
    }

    // Validate duration
    if (!Object.keys(LONG_TERM_APY_RATES).includes(duration.toString())) {
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

    // Check if user has access to this duration
    if (!userLevel.availableDurations.includes(parseInt(duration))) {
      return res.status(403).json({
        success: false,
        error: `Level ${userLevel.level} (${userLevel.title}) does not have access to ${duration}-day staking. Available durations: ${userLevel.availableDurations.join(', ')} days`
      });
    }
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
    const apy = calculateAPY(parseInt(duration), userLevel.level);

    // Calculate expected rewards
    const expectedReward = Math.floor((stakeAmount * apy / 100) * (duration / 365));

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
router.post("/per-meme", async (req, res) => {
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
          const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
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
          const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
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


          const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

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
      apy: `${calculateAPY(duration, userLevel.level)}%`,
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

// ✅ POST /api/staking/unstake - Unstake with penalty if early
router.post("/unstake", async (req, res) => {
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

    if (!stakeData.wallet || stakeData.wallet !== wallet) {
      return res.status(404).json({
        success: false,
        error: "Staking position not found"
      });
    }

    if (stakeData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: "Staking position is not active"
      });
    }

    const now = new Date();
    const endDate = new Date(stakeData.endDate);
    const isEarly = now < endDate;

    let finalAmount = parseFloat(stakeData.amount);
    let penalty = 0;
    let bonusReward = 0;

    if (isEarly) {
      // Early unstaking - apply 15% penalty
      penalty = finalAmount * 0.15;
      finalAmount = finalAmount - penalty;
    } else {
      // Completed staking - add level-based bonus
      bonusReward = parseFloat(stakeData.bonusReward);
      finalAmount = parseFloat(stakeData.totalReward);
    }

    // Calculate fees (2% burn, 3% treasury)
    const burnFee = finalAmount * 0.02;
    const treasuryFee = finalAmount * 0.03;
    const totalFees = burnFee + treasuryFee;
    const userReceives = finalAmount - totalFees;

    // Update staking record
    await redis.hSet(`staking:${stakeId}`, {
      status: 'completed',
      unstakedAt: now.toISOString(),
      isEarlyUnstake: isEarly,
      penalty: penalty,
      bonusReceived: bonusReward,
      finalAmount: finalAmount,
      burnFee: burnFee,
      treasuryFee: treasuryFee,
      userReceives: userReceives,
      claimed: true
    });

    // Remove from active stake sets (support both schemas)
    await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);

    // Update totals (best-effort across schemas)
    await redis.incrByFloat('staking:total_staked', -parseFloat(stakeData.amount));
    await redis.incrByFloat('staking:total_long_term_staked', -parseFloat(stakeData.amount));
    await redis.incrByFloat('staking:total_burned', burnFee);
    await redis.incrByFloat('staking:total_treasury', treasuryFee);

    if (penalty > 0) {
      await redis.incrByFloat('staking:total_penalties', penalty);
    }

    // Log the unstaking action
    await redis.lPush('staking_logs', JSON.stringify({
      action: 'unstake_completed',
      stakeId,
      wallet,
      originalAmount: parseFloat(stakeData.amount),
      isEarly,
      penalty,
      bonusReward,
      userReceives,
      timestamp: now.toISOString()
    }));

    res.json({
      success: true,
      message: isEarly ? "Early unstaking completed with penalty" : "Staking completed successfully",
      unstakeData: {
        stakeId,
        originalAmount: parseFloat(stakeData.amount),
        isEarlyUnstake: isEarly,
        penalty: penalty,
        bonusReceived: bonusReward,
        burnFee: burnFee,
        treasuryFee: treasuryFee,
        userReceives: userReceives,
        completedAt: now.toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error unstaking:', error);
    res.status(500).json({
      success: false,
      error: "Failed to unstake"
    });
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
    const positions = [];

    for (const key of stakingKeys) {
      if (key.includes(':position:')) {
        const positionData = await redis.hGetAll(key);

        if (positionData && Object.keys(positionData).length > 0) {
          const walletAddress = key.split(':')[1];
          const positionId = key.split(':')[3];

          // Calculate current value and time remaining
          const startTime = new Date(positionData.startTime);
          const endTime = new Date(positionData.endTime);
          const now = new Date();

          const timeRemaining = Math.max(0, endTime - now);
          const totalDuration = endTime - startTime;
          const elapsed = now - startTime;
          const progress = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;

          // Calculate current rewards
          const baseAmount = parseFloat(positionData.amount) || 0;
          const apy = parseFloat(positionData.apy) || 0;
          const currentRewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));

          const position = {
            id: positionId,
            walletAddress: walletAddress,
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

        // Calculate rewards
        const baseAmount = parseFloat(positionData.amount) || 0;
        const apy = parseFloat(positionData.apy) || 0;
        const currentRewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));

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
          daysRemaining: Math.ceil(timeRemaining / (24 * 60 * 60 * 1000))
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

    // Calculate rewards
    const startTime = new Date(positionData.startTime);
    const elapsed = now - startTime;
    const apy = parseFloat(positionData.apy) || 0;
    const rewards = (baseAmount * (apy / 100) * (elapsed / (365 * 24 * 60 * 60 * 1000)));

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
router.post('/stake', async (req, res) => {
  try {
    const { wallet, amount, duration, tier } = req.body;

    if (!wallet || !amount || !duration) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, amount, duration"
      });
    }

    // Enforce minimum WALDO worth: 3 XRP
    try {
      const worth = await ensureMinWaldoWorth(wallet, 1);
      if (!worth.ok) {
        return res.status(403).json({
          success: false,
          error: `Minimum balance required: ${worth.requiredWaldo.toLocaleString()} WALDO (~${worth.minXrp} XRP at ${worth.waldoPerXrp.toLocaleString()} WALDO/XRP). Your balance: ${worth.balance.toLocaleString()} WALDO`,
          details: worth
        });
      }
    } catch (e) {
      console.warn('Worth check failed, denying stake:', e.message || e);
      return res.status(503).json({ success: false, error: 'Temporary wallet worth check failure. Please try again.' });
    }


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
            daysRemaining: Math.max(0, Math.ceil((new Date(stakeData.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
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
            daysRemaining: Math.max(0, Math.ceil((new Date(stakeData.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
          });
          seen.add(stakeId);
        }
      } catch (e) { /* ignore individual errors */ }
    }

    return res.json({
      success: true,
      positions,
      totalPositions: positions.length,
      totalStaked: positions.reduce((sum, pos) => sum + pos.amount, 0)
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
      return res.status(400).json({ success: false, error: 'Stake not active' });
    }
    const now = Date.now();
    const end = new Date(stakeData.endDate).getTime();
    if (now < end) {
      return res.status(400).json({ success: false, error: 'Stake not yet matured' });
    }

    const type = stakeData.type || 'long_term';

    // Calculate total amount to receive (stake + rewards)
    const originalAmount = parseFloat(stakeData.amount || 0);
    const expectedReward = parseFloat(stakeData.expectedReward || 0);
    const totalAmount = originalAmount + expectedReward;

    // Get distributor wallet address
    const DISTRIBUTOR_WALLET = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.WALDO_DISTRIBUTOR_ADDRESS || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
    const ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
    const CURRENCY = process.env.WALDO_CURRENCY || 'WLO';

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

    // Get stake info and mark as completed
    const offer = await redis.hGetAll(`stake:redeem_offer:${uuid}`);
    const stakeId = offer?.stakeId;
    const wallet = offer?.wallet;
    const type = offer?.type || 'long_term';
    if (!stakeId || !wallet) return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'stake_not_found' });

    const stakeKey = `staking:${stakeId}`;
    const stakeData = await redis.hGetAll(stakeKey);
    if (!stakeData) return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'stake_data_missing' });

    // Mark stake as completed since Payment was successful
    await redis.hSet(stakeKey, {
      status: 'completed',
      redeemedAt: new Date().toISOString(),
      redeemTx: txid || '',
      claimed: true
    });

    // Remove from active sets
    await redis.sRem(`user:${wallet}:long_term_stakes`, stakeId);
    await redis.sRem(`staking:user:${wallet}`, stakeId);
    await redis.sRem('staking:active', stakeId);

    // Update stats
    const amt = Number(stakeData.amount || 0);
    if (Number.isFinite(amt) && amt > 0) {
      try { await redis.incrByFloat('staking:total_staked', -amt); } catch (_) { }
      try { await redis.incrByFloat('staking:total_long_term_staked', -amt); } catch (_) { }
    }

    // Clean up offer
    await redis.del(`stake:redeem_offer:${uuid}`);

    const originalAmount = parseFloat(stakeData.amount || 0);
    const expectedReward = parseFloat(stakeData.expectedReward || 0);
    const totalAmount = originalAmount + expectedReward;

    console.log(`✅ Stake redeemed: ${wallet} received ${totalAmount.toFixed(2)} WALDO (${stakeId})`);
    return res.json({ ok: true, signed: true, account, txid, paid: true, amount: totalAmount.toFixed(2) });

  } catch (e) {
    console.error('redeem status error', e);
    return res.json({ ok: true, signed: false, error: e.message });
  }
});
    };
let prepared;
try {
  prepared = await client.autofill(payment);
} catch (e) {
  await client.disconnect();
  return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'sender_account_not_found' });
}
const signedTx = wallet.sign(prepared);
const result = await client.submitAndWait(signedTx.tx_blob);
const ok = (result?.result?.meta?.TransactionResult === 'tesSUCCESS') || (result?.engine_result === 'tesSUCCESS');
const deliveredHash = result?.result?.hash || result?.tx_json?.hash || null;
await client.disconnect();

if (!ok) {
  return res.json({ ok: true, signed: true, account, txid, paid: false, error: 'send_failed' });
}

// Finalize stake state
await redis.hSet(stakeKey, {
  status: 'completed',
  redeemedAt: new Date().toISOString(),
  redeemTx: deliveredHash || '',
  claimed: true,
  userReceives: value.toFixed(6)
});

// Remove from active sets
if (type === 'per_meme') {
  await redis.sRem(`user:${stakeData.wallet}:per_meme_stakes`, stakeId);
} else {
  await redis.sRem(`user:${stakeData.wallet}:long_term_stakes`, stakeId);
  await redis.sRem(`staking:user:${stakeData.wallet}`, stakeId);
  await redis.sRem('staking:active', stakeId);
}

// Log redemption
await redis.lPush('staking_logs', JSON.stringify({
  action: type === 'per_meme' ? 'per_meme_stake_redeemed' : 'long_term_stake_redeemed',
  stakeId,
  wallet: stakeData.wallet,
  amount: value,
  txid: deliveredHash,
  timestamp: new Date().toISOString()
}));

await redis.set(processedKey, '1', { EX: 604800 });

return res.json({ ok: true, signed: true, account, txid, paid: true, deliveredTx: deliveredHash });
  } catch (e) {
  console.error('redeem status error', e);
  return res.status(500).json({ ok: false, error: e.message });
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

export default router;


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
