// 🤖 WALDOCOIN TRADING BOT - Buy/Sell WLO Tokens

import xrpl from 'xrpl';
import { createClient } from 'redis';
import cron from 'node-cron';
import dotenv from 'dotenv';
import winston from 'winston';


dotenv.config();

// ===== CONFIGURATION =====
// Use multiple XRPL nodes for better reliability
const XRPL_NODES = [
  'wss://s1.ripple.com',
  'wss://s2.ripple.com',
  'wss://xrpl.ws',
  'wss://xrplcluster.com' // backup node; may be rate-limited
];
const XRPL_NODE = process.env.XRPL_NODE || XRPL_NODES[0];
const TRADING_WALLET_SECRET = process.env.TRADING_WALLET_SECRET;
const TRADING_WALLET_SECRET_2 = process.env.TRADING_WALLET_SECRET_2; // Second bot wallet
const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WALDO_CURRENCY = process.env.WALDO_CURRENCY || 'WLO';
const STEALTH_MODE = process.env.STEALTH_MODE === 'true';

// ===== PROFIT MANAGEMENT CONFIGURATION =====
const PROFIT_TRACKING = process.env.PROFIT_TRACKING_ENABLED === 'true';
const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE_XRP) || 70;
const PROFIT_RESERVE_THRESHOLD = parseFloat(process.env.PROFIT_RESERVE_THRESHOLD) || 200;
const PROFIT_RESERVE_PERCENTAGE = parseFloat(process.env.PROFIT_RESERVE_PERCENTAGE) || 50;
const PROFIT_CHECK_INTERVAL = parseInt(process.env.PROFIT_CHECK_INTERVAL) || 60;

// ===== PROFIT SKIMMING CONFIGURATION =====
const PROFIT_SKIM_ENABLED = process.env.PROFIT_SKIM_ENABLED !== 'false'; // Enabled by default
const PROFIT_SKIM_WALLET = process.env.PROFIT_SKIM_WALLET || 'rfFbyBGrgwmggpEAYXAEQGVyrYRCBAoEWV';
const PROFIT_SKIM_THRESHOLD = parseFloat(process.env.PROFIT_SKIM_THRESHOLD) || 50; // Skim when profit > 50 XRP
const PROFIT_SKIM_PERCENTAGE = parseFloat(process.env.PROFIT_SKIM_PERCENTAGE) || 80; // Skim 80% of profits
const MIN_BOT_BALANCE = parseFloat(process.env.MIN_BOT_BALANCE) || 30; // Keep at least 30 XRP per bot for trading

// ===== TRADING PARAMETERS =====
const MIN_TRADE_XRP = parseFloat(process.env.MIN_TRADE_AMOUNT_XRP) || 0.5; // Optimized for 10 XRP perpetual trading
const MAX_TRADE_XRP = parseFloat(process.env.MAX_TRADE_AMOUNT_XRP) || 1.5; // Reduced for sustainability
const PRICE_SPREAD = parseFloat(process.env.PRICE_SPREAD_PERCENTAGE) || 0; // No spread for longevity
const MARKET_MAKING = process.env.MARKET_MAKING_ENABLED === 'true';

// ===== LOGGER SETUP =====
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/trading-bot.log' })
  ]
});

// ===== INITIALIZE SERVICES =====
let client = new xrpl.Client(XRPL_NODE);
const redis = createClient({ url: process.env.REDIS_URL });

let tradingWallet = null;
let tradingWallet2 = null; // Second bot wallet
let currentPrice = 0;
let dailyVolume = 0;
let currentNodeIndex = 0;
let reconnectAttempts = 0;
let isReconnecting = false;

// ===== REDIS CONNECTION =====
redis.on('error', (err) => logger.error('Redis error:', err));
redis.on('connect', () => logger.info('Connected to Redis'));

// Connect to Redis
async function connectRedis() {
  try {
    // Check if already connected
    if (redis.isOpen) {
      logger.info('✅ Redis already connected');
      return true;
    }

    await redis.connect();
    logger.info('✅ Redis connected successfully');
    return true;
  } catch (error) {
    // If error is "Socket already opened", it means we're already connected
    if (error.message && error.message.includes('Socket already opened')) {
      logger.info('✅ Redis already connected (socket open)');
      return true;
    }

    logger.error('❌ Redis connection failed:', error);
    return false;
  }
}
// ===== ROBUST XRPL CONNECTION MANAGER =====
async function connectToNextNode() {
  if (isReconnecting) return false;

  isReconnecting = true;

  try {
    // Try current node first, then cycle through alternatives
    for (let attempts = 0; attempts < XRPL_NODES.length; attempts++) {
      const nodeUrl = XRPL_NODES[currentNodeIndex];

      try {
        logger.info(`🔄 Attempting connection to XRPL node: ${nodeUrl}`);

        // Disconnect existing client if connected
        if (client.isConnected()) {
          await client.disconnect();
        }

        // Create new client with current node
        client = new xrpl.Client(nodeUrl);
        setupClientEventHandlers();

        // Attempt connection with timeout
        await Promise.race([
          client.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 10000))
        ]);

        if (client.isConnected()) {
          logger.info(`✅ Successfully connected to XRPL node: ${nodeUrl}`);
          reconnectAttempts = 0;
          isReconnecting = false;
          return true;
        }
      } catch (nodeError) {
        logger.warn(`❌ Failed to connect to ${nodeUrl}: ${nodeError.message}`);
        currentNodeIndex = (currentNodeIndex + 1) % XRPL_NODES.length;
      }
    }

    // If all nodes failed, wait and try again
    reconnectAttempts++;
    const backoffDelay = Math.min(30000, 5000 * reconnectAttempts); // Max 30 seconds
    logger.error(`❌ All XRPL nodes failed. Attempt ${reconnectAttempts}. Retrying in ${backoffDelay / 1000}s...`);

    setTimeout(() => {
      isReconnecting = false;
      connectToNextNode();
    }, backoffDelay);

    return false;
  } catch (error) {
    logger.error('❌ Critical connection error:', error);
    isReconnecting = false;
    return false;
  }
}

function setupClientEventHandlers() {
  client.on('error', (err) => {
    logger.warn('XRPL client error:', err);
  });

  client.on('connectionError', (err) => {
    logger.warn('XRPL connection error:', err);
    if (!isReconnecting) {
      setTimeout(() => connectToNextNode(), 2000);
    }
  });

  client.on('disconnected', (code) => {
    logger.warn(`XRPL disconnected: ${code}`);
    // Only reconnect if it's an unexpected disconnect (not normal close 1000)
    // Code 1000 = normal close, don't reconnect immediately
    if (code !== 1000) {
      logger.warn(`⚠️ Unexpected disconnect (code ${code}), attempting reconnection...`);
      if (!isReconnecting) {
        setTimeout(() => connectToNextNode(), 1000);
      }
    } else {
      logger.info('✅ Normal disconnect - no reconnection needed');
    }
  });
}

// Initial setup
setupClientEventHandlers();

await redis.connect();

// Load existing daily volume from Redis
try {
  const existingVolume = await redis.get('waldo:daily_volume');
  if (existingVolume) {
    dailyVolume = parseFloat(existingVolume);
    logger.info(`📊 Loaded existing daily volume: ${dailyVolume.toFixed(2)} XRP`);
  }

  // Initialize Redis keys if they don't exist
  const tradesCount = await redis.lLen('waldo:trades');
  logger.info(`📈 Current trades count: ${tradesCount}`);

  // Set bot status and initialize default settings
  await redis.set('volume_bot:status', 'running');
  await redis.set('volume_bot:last_startup', new Date().toISOString());

  // Initialize default frequency if not set
  const currentFrequency = await redis.get('volume_bot:frequency');
  if (!currentFrequency) {
    await redis.set('volume_bot:frequency', '30'); // Default to 30 minutes
    logger.info('📅 Initialized default trading frequency: 30 minutes');
  } else {
    logger.info(`📅 Current trading frequency: ${currentFrequency === 'random' ? 'Random (5-45 min)' : currentFrequency + ' minutes'}`);
  }

  // Initialize default trading mode if not set
  const currentTradingMode = await redis.get('volume_bot:trading_mode');
  if (!currentTradingMode) {
    await redis.set('volume_bot:trading_mode', 'perpetual'); // Default to perpetual mode
    logger.info('🎛️ Initialized default trading mode: Perpetual (weighted balance-aware)');
  } else {
    logger.info(`🎛️ Current trading mode: ${currentTradingMode}`);
  }

  // Initialize profit tracking starting balance if not set
  const startingBalance = await redis.get('volume_bot:starting_balance');
  if (!startingBalance) {
    await redis.set('volume_bot:starting_balance', STARTING_BALANCE.toString());
    logger.info(`💰 Initialized profit tracking starting balance: ${STARTING_BALANCE} XRP`);
  } else {
    logger.info(`💰 Profit tracking starting balance: ${startingBalance} XRP`);
  }

} catch (error) {
  logger.error('❌ Error loading daily volume:', error);
}

// ===== XRPL CONNECTION =====
async function connectXRPL() {
  try {
    // For stealth mode, we don't need actual XRPL trading
    if (STEALTH_MODE) {
      logger.info('🥷 Stealth mode - skipping XRPL wallet connection');
      return true;
    }

    if (!TRADING_WALLET_SECRET) {
      logger.warn('⚠️ No trading wallet secret provided - running in simulation mode');
      return true;
    }

    // Use the robust connection manager
    const connected = await connectToNextNode();
    if (!connected) {
      throw new Error('Failed to connect to any XRPL node');
    }

    tradingWallet = xrpl.Wallet.fromSeed(TRADING_WALLET_SECRET);
    logger.info(`🔗 Connected to XRPL - Trading wallet 1: ${tradingWallet.classicAddress}`);

    // Load second wallet if available
    if (TRADING_WALLET_SECRET_2) {
      tradingWallet2 = xrpl.Wallet.fromSeed(TRADING_WALLET_SECRET_2);
      logger.info(`🔗 Connected to XRPL - Trading wallet 2: ${tradingWallet2.classicAddress}`);
    }

    logger.info(`🪙 WALDO token configured: currency=${WALDO_CURRENCY} issuer=${WALDO_ISSUER}`);

    // Ensure WLO trustline exists and is sufficient for both wallets
    try {
      await ensureWLOTrustline(tradingWallet);
      if (tradingWallet2) {
        await ensureWLOTrustline(tradingWallet2);
      }
    } catch (e) {
      logger.warn('⚠️ Trustline verification failed:', e);
    }

    return true;
  } catch (error) {
    logger.error('❌ XRPL connection failed:', error);
    return false;
  }
}

// Ensure the trading wallet has a trustline to the WALDO issuer (WLO)
async function ensureWLOTrustline(wallet = tradingWallet) {
  try {
    if (STEALTH_MODE) return;
    if (!wallet || !client.isConnected()) return;

    // Check existing trustlines
    const lines = await client.request({
      command: 'account_lines',
      account: wallet.classicAddress,
      ledger_index: 'validated'
    });

    const existing = (lines.result.lines || []).find(
      l => l.currency === WALDO_CURRENCY && l.account === WALDO_ISSUER
    );

    if (existing) {
      // Already have a trustline; optionally could raise limit if needed
      return true;
    }

    // Create trustline with a generous limit so trades don't get blocked by trust limit
    const trustSet = {
      TransactionType: 'TrustSet',
      Account: wallet.classicAddress,
      LimitAmount: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER,
        value: '100000000' // 100M WLO
      }
    };

    const prepared = await client.autofill(trustSet);
    const signed = tradingWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result?.meta?.TransactionResult === 'tesSUCCESS') {
      logger.info('✅ WLO trustline established');
      return true;
    }

    throw new Error(`TrustSet failed with code ${result.result?.meta?.TransactionResult}`);
  } catch (e) {
    logger.warn('⚠️ Trustline setup error:', e);
  }
}


// ===== PRICE FUNCTIONS =====
async function getCurrentWaldoPrice() {
  try {
    // Get REAL-TIME price from XRPL DEX order book
    const orderBookRequest = {
      command: 'book_offers',
      taker_gets: {
        currency: 'XRP'
      },
      taker_pays: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER
      },
      limit: 10
    };

    // In stealth mode, prefer backend price to avoid XRPL calls
    if (STEALTH_MODE) {
      try {
        const api = process.env.BACKEND_API_URL || 'https://waldocoin-backend-api.onrender.com';
        const r = await globalThis.fetch(`${api}/api/market/wlo`, { cache: 'no-store' });
        const j = await r.json();
        let selected = j?.xrpPerWlo || j?.best?.mid || null;
        // Apply optional env multiplier/floor to match backend controls
        const mult = Number(process.env.PRICE_MULTIPLIER_XRP_PER_WLO);
        const floor = Number(process.env.PRICE_FLOOR_XRP_PER_WLO);
        if (isFinite(mult) && mult > 0) selected = selected * mult;
        if (isFinite(floor) && floor > 0) selected = Math.max(selected, floor);
        if (selected && isFinite(selected) && selected > 0) {
          currentPrice = selected; await redis.set('waldo:current_price', String(selected));
          logger.info(`📊 Stealth mode price from backend: ${selected.toFixed(8)} XRP/WLO`);
          return selected;
        }
      } catch (e) { logger.warn('⚠️ Stealth price fetch failed, falling back to XRPL'); }
    }

    const response = await client.request(orderBookRequest);

    // Compute best ASK from WLO->XRP book (offers selling WLO for XRP)
    let askPrice = null;
    if (response.result && response.result.offers && response.result.offers.length > 0) {
      const bestOffer = response.result.offers[0];
      // Compute price strictly from amounts to avoid quality scaling issues
      const getsDrops = Number(bestOffer.TakerGets);
      const paysWlo = Number(bestOffer.TakerPays?.value);
      const pAsk = (getsDrops > 0 && paysWlo > 0) ? ((getsDrops / 1_000_000) / paysWlo) : null;
      if (pAsk && isFinite(pAsk) && pAsk > 0) {
        askPrice = pAsk; // XRP per WLO
      }
    }

    // Also query reverse book for best BID (offers buying WLO with XRP)
    const reverseOrderBookRequest = {
      command: 'book_offers',
      taker_gets: {
        currency: WALDO_CURRENCY,
        issuer: WALDO_ISSUER
      },
      taker_pays: {
        currency: 'XRP'
      },
      limit: 10
    };

    const reverseResponse = await client.request(reverseOrderBookRequest);

    let bidPrice = null;
    if (reverseResponse.result && reverseResponse.result.offers && reverseResponse.result.offers.length > 0) {
      const bestOffer = reverseResponse.result.offers[0];
      // Compute price strictly from amounts to avoid quality scaling issues
      const paysDrops = Number(bestOffer.TakerPays);
      const getsWlo = Number(bestOffer.TakerGets?.value);
      const pBid = (paysDrops > 0 && getsWlo > 0) ? ((paysDrops / 1_000_000) / getsWlo) : null;
      if (pBid && isFinite(pBid) && pBid > 0) {
        bidPrice = pBid; // XRP per WLO
      }
    }

    // Choose a sane price: use mid of bid/ask when both valid; otherwise whichever is available
    let selected = null;
    if (askPrice && bidPrice) {
      selected = (askPrice + bidPrice) / 2;
      logger.info(`📊 Top-of-book: bid=${bidPrice.toFixed(8)} ask=${askPrice.toFixed(8)} mid=${selected.toFixed(8)} XRP/WLO`);
    } else if (askPrice || bidPrice) {
      selected = askPrice || bidPrice;
      logger.info(`📊 Top-of-book single-sided: ${selected.toFixed(8)} XRP/WLO`);
    }

    // Apply optional admin guardrails for sanity (min/max valid price)
    const minGuardRaw = await redis.get('volume_bot:min_valid_price');
    const maxGuardRaw = await redis.get('volume_bot:max_valid_price');
    const minGuard = minGuardRaw ? parseFloat(minGuardRaw) : 0;
    const maxGuard = maxGuardRaw ? parseFloat(maxGuardRaw) : 0;

    const applyGuardrails = (p) => {
      let guarded = p;
      if (minGuard && guarded < minGuard) guarded = minGuard;
      if (maxGuard && guarded > maxGuard) guarded = maxGuard;
      return guarded;
    };

    if (selected && isFinite(selected) && selected > 0) {
      // Apply admin price controls from Redis (UI-controlled), fallback to env
      const multKey = await redis.get('price:xrp_per_wlo:multiplier');
      const floorKey = await redis.get('price:xrp_per_wlo:floor');
      let adj = selected;
      const mult = Number(multKey ?? process.env.PRICE_MULTIPLIER_XRP_PER_WLO);
      const floor = Number(floorKey ?? process.env.PRICE_FLOOR_XRP_PER_WLO);
      if (isFinite(mult) && mult > 0) adj *= mult;
      if (isFinite(floor) && floor > 0) adj = Math.max(adj, floor);
      const guarded = applyGuardrails(adj);
      currentPrice = guarded;
      await redis.set('waldo:current_price', currentPrice.toString());
      logger.info(`📊 Real-time price selected: ${currentPrice.toFixed(8)} XRP per WLO`);
      return currentPrice;
    }

    // External price fallback (Magnetic API or configured URL)
    try {
      const apiUrl = (await redis.get('volume_bot:external_price_url')) || process.env.EXTERNAL_PRICE_URL || '';
      if (apiUrl) {
        const resp = await globalThis.fetch(apiUrl);
        if (resp.ok) {
          const data = await resp.json();
          // Expect data.price in XRP per WLO (configure your endpoint accordingly)
          const p = parseFloat(data.price);
          if (p > 0 && isFinite(p)) {
            const guarded = applyGuardrails(p);
            currentPrice = guarded;
            await redis.set('waldo:current_price', currentPrice.toString());
            logger.info(`📊 External price selected: ${currentPrice.toFixed(8)} XRP per WLO`);
            return currentPrice;
          }
        } else {
          logger.warn(`⚠️ External price fetch failed: HTTP ${resp.status}`);
        }
      }
    } catch (e) {
      logger.warn('⚠️ External price fetch error:', e);
    }

    // If no real price available, use last known price or fallback
    const lastPrice = await redis.get('waldo:current_price');
    if (lastPrice && parseFloat(lastPrice) > 0) {
      currentPrice = parseFloat(lastPrice);
      logger.warn('⚠️ Using last known price from Redis');
      return currentPrice;
    }

    // Final fallback
    const fallbackPrice = 0.00006400;
    currentPrice = fallbackPrice;
    logger.warn('⚠️ No market data available, using fallback price');
    return fallbackPrice;

  } catch (error) {
    logger.error('❌ Real-time price fetch error:', error);

    // Try to use last known price
    const lastPrice = await redis.get('waldo:current_price');
    if (lastPrice && parseFloat(lastPrice) > 0) {
      currentPrice = parseFloat(lastPrice);
      return currentPrice;
    }

    // Final fallback
    const fallbackPrice = 0.00006400;
    currentPrice = fallbackPrice;
    return fallbackPrice;
  }
}

// ===== BALANCE CHECKING FUNCTIONS =====
async function getXRPBalance(address) {
  try {
    const accountInfo = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated'
    });
    return parseFloat(xrpl.dropsToXrp(accountInfo.result.account_data.Balance));
  } catch (error) {
    logger.error('❌ Error getting XRP balance:', error);
    return 0;
  }
}

async function getWLOBalance(address) {
  try {
    const accountLines = await client.request({
      command: 'account_lines',
      account: address,
      ledger_index: 'validated'
    });

    const wloLine = accountLines.result.lines.find(
      line => line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
    );

    if (wloLine) {
      const balance = parseFloat(wloLine.balance);
      // WLO balance can be negative (liability) or positive (asset)
      // We want the absolute value for trading purposes
      return Math.abs(balance);
    }
    return 0;
  } catch (error) {
    logger.error('❌ Error getting WLO balance:', error);
    return 0;
  }
}

// ===== TRADING FUNCTIONS =====
async function buyWaldo(userAddress, xrpAmount, wallet = tradingWallet) {
  try {
    // Ensure XRPL connection is active before attempting trade
    if (!client.isConnected() && !isReconnecting) {
      logger.warn('⚠️ XRPL client disconnected, attempting robust reconnection...');
      const connected = await connectToNextNode();
      if (!connected) {
        throw new Error('Failed to establish XRPL connection for buy trade');
      }
    }
    // Determine which bot this is
    const isBot2 = wallet?.classicAddress === tradingWallet2?.classicAddress;

    // Read admin-configured min/max from Redis (fallback to defaults)
    // Use bot-specific settings if Bot 2
    let adminMinRaw, adminMaxRaw;
    if (isBot2) {
      adminMinRaw = await redis.get('volume_bot:bot2_min_trade_size');
      adminMaxRaw = await redis.get('volume_bot:bot2_max_trade_size');
    } else {
      adminMinRaw = await redis.get('volume_bot:min_trade_size');
      adminMaxRaw = await redis.get('volume_bot:max_trade_size');
    }
    const effectiveMin = adminMinRaw ? parseFloat(adminMinRaw) : MIN_TRADE_XRP;
    const effectiveMax = adminMaxRaw ? parseFloat(adminMaxRaw) : MAX_TRADE_XRP;

    // Validate provided amount against effective limits (admin overrides defaults)
    if (xrpAmount < effectiveMin || xrpAmount > effectiveMax) {
      throw new Error(`Trade amount must be between ${effectiveMin} and ${effectiveMax} XRP`);
    }

    const price = await getCurrentWaldoPrice();

    // Safety check: prevent zero or invalid price
    if (price <= 0 || isNaN(price) || !isFinite(price)) {
      throw new Error('Invalid price calculation - cannot execute trade');
    }

    // Helper to attempt a Payment with PartialPayment + optional path and DeliverMin
    const attempt = async (amountXrp, deliverFactor) => {
      const wantAmount = parseFloat(((amountXrp / price) * (1 - PRICE_SPREAD / 100)).toFixed(6));
      if (!isFinite(wantAmount) || wantAmount <= 0) {
        throw new Error('Invalid trade amount calculation');
      }

      // Path finding on public clusters may require permissions; skip explicit Paths to avoid 'noPermission'
      let bestPaths;
      const deliverMinVal = Math.max(0, parseFloat((wantAmount * (deliverFactor ?? 0.85)).toFixed(6)));

      // Build Partial Payment to allow fills instead of failing with tecPATH_PARTIAL
      const payment = {
        TransactionType: 'Payment',
        Account: wallet.classicAddress,
        Destination: userAddress,
        Amount: { currency: WALDO_CURRENCY, value: wantAmount.toFixed(6), issuer: WALDO_ISSUER },
        SendMax: xrpl.xrpToDrops(amountXrp.toString()),
        Flags: 0x00020000, // tfPartialPayment
        DeliverMin: { currency: WALDO_CURRENCY, value: deliverMinVal.toFixed(6), issuer: WALDO_ISSUER }
      };
      if (bestPaths) payment.Paths = bestPaths;

      const prepared = await client.autofill(payment);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      const code = result.result?.meta?.TransactionResult;
      if (code === 'tesSUCCESS') {
        await recordTrade('BUY', userAddress, amountXrp, wantAmount, price);
        return { success: true, hash: result.result.hash, waldoAmount: wantAmount, price };
      }

      throw new Error(`Transaction failed: ${code || 'unknown'}`);
    };

    // Try main amount, then smaller fallbacks within >= MIN_TRADE_XRP
    try {
      return await attempt(xrpAmount, 0.50); // accept 50% of expected WLO on first try
    } catch (e1) {
      if ((e1.message || '').includes('tecPATH_DRY') || (e1.message || '').includes('tecPATH_PARTIAL')) {
        logger.warn(`⚠️ ${e1.message?.includes('tecPATH_DRY') ? 'tecPATH_DRY' : 'tecPATH_PARTIAL'} on buy - falling back to passive buy offer`);

        // Fallback: Create a passive buy offer on the order book
        const wantAmount = parseFloat(((xrpAmount / price) * (1 - PRICE_SPREAD / 100)).toFixed(6));
        const offer = {
          TransactionType: 'OfferCreate',
          Account: wallet.classicAddress,
          TakerGets: { // WLO we want to receive
            currency: WALDO_CURRENCY,
            value: wantAmount.toFixed(6),
            issuer: WALDO_ISSUER
          },
          TakerPays: xrpl.xrpToDrops(xrpAmount.toString()), // XRP we're offering
          Flags: 0x00010000 // tfPassive
        };

        try {
          // Get current ledger info to set proper sequence numbers
          const ledgerIndex = await client.getLedgerIndex();

          // Manually set all required fields to avoid autofill delays
          offer.Sequence = await client.getAccountInfo(wallet.classicAddress).then(info => info.account_data.Sequence);
          offer.Fee = '12'; // Standard fee in drops
          offer.LastLedgerSequence = ledgerIndex + 300; // 300 ledgers = ~1500 seconds (~25 minutes)

          const signed = wallet.sign(offer);
          const result = await client.submitAndWait(signed.tx_blob, { timeout: 30000 });

          const code = result.result?.meta?.TransactionResult;
          if (code === 'tesSUCCESS') {
            await recordTrade('BUY', userAddress, xrpAmount, wantAmount, price);
            logger.info(`✅ Passive buy offer created: ${wantAmount.toFixed(0)} WLO for ${xrpAmount.toFixed(4)} XRP`);
            return { success: true, hash: result.result.hash, waldoAmount: wantAmount, price };
          }
          throw new Error(`Passive offer failed: ${code || 'unknown'}`);
        } catch (offerError) {
          // If ledger sequence error, try once more with fresh sequence
          if ((offerError.message || '').includes('LastLedgerSequence') || (offerError.message || '').includes('Sequence')) {
            logger.warn(`⚠️ Ledger sequence error on buy offer, retrying with fresh sequence...`);
            try {
              const ledgerIndex2 = await client.getLedgerIndex();
              const offer2 = { ...offer };
              const accountInfo2 = await client.request({
                command: 'account_info',
                account: wallet.classicAddress
              });
              offer2.Sequence = accountInfo2.result.account_data.Sequence;
              offer2.Fee = '12';
              offer2.LastLedgerSequence = ledgerIndex2 + 300;

              const signed2 = wallet.sign(offer2);
              const result2 = await client.submitAndWait(signed2.tx_blob, { timeout: 30000 });

              const code2 = result2.result?.meta?.TransactionResult;
              if (code2 === 'tesSUCCESS') {
                await recordTrade('BUY', userAddress, xrpAmount, wantAmount, price);
                logger.info(`✅ Passive buy offer created (retry): ${wantAmount.toFixed(0)} WLO for ${xrpAmount.toFixed(4)} XRP`);
                return { success: true, hash: result2.result.hash, waldoAmount: wantAmount, price };
              }
            } catch (_) { }
          }
          logger.warn(`⚠️ Passive buy offer also failed: ${offerError.message}`);
          throw e1; // Throw original error
        }
      }
      throw e1;
    }
  } catch (error) {
    logger.error('❌ Buy WALDO failed:', error);
    return { success: false, error: error.message };
  }
}

async function sellWaldo(userAddress, waldoAmount, wallet = tradingWallet) {
  try {
    // Ensure XRPL connection is active before attempting trade
    if (!client.isConnected() && !isReconnecting) {
      logger.warn('⚠️ XRPL client disconnected, attempting robust reconnection...');
      const connected = await connectToNextNode();
      if (!connected) {
        throw new Error('Failed to establish XRPL connection for sell trade');
      }
    }

    const price = await getCurrentWaldoPrice();

    // Safety check: prevent zero or invalid price
    if (price <= 0 || isNaN(price) || !isFinite(price)) {
      throw new Error('Invalid price calculation - cannot execute trade');
    }

    // SIMPLIFIED APPROACH: Use Payment transactions for SELL (like BUY does)
    // This is more reliable than passive offers which seem to hang on submitAndWait
    const executeSellPayment = async (wloAmount) => {
      // Calculate XRP we want to receive (slightly below market for quick execution)
      const discountedPrice = price * 0.95; // 5% below market for reliable fills
      const xrpTarget = parseFloat((wloAmount * discountedPrice).toFixed(6));

      if (!isFinite(xrpTarget) || xrpTarget <= 0) {
        throw new Error('Invalid trade amount calculation');
      }

      // Check connection before submitting
      if (!client.isConnected()) {
        throw new Error('XRPL client not connected before SELL');
      }

      logger.info(`📍 SELL: Executing payment for ${wloAmount} WLO to receive ~${xrpTarget.toFixed(6)} XRP`);

      // Create a Payment that sends WLO and receives XRP
      const payment = {
        TransactionType: 'Payment',
        Account: wallet.classicAddress,
        Destination: wallet.classicAddress, // Send to self to convert WLO -> XRP
        Amount: xrpl.xrpToDrops(xrpTarget.toString()), // XRP we want to receive
        SendMax: { // WLO we're willing to send
          currency: WALDO_CURRENCY,
          value: parseFloat(wloAmount).toFixed(6),
          issuer: WALDO_ISSUER
        },
        Flags: 0x00020000, // tfPartialPayment
        DeliverMin: xrpl.xrpToDrops((xrpTarget * 0.5).toFixed(6)) // Accept 50% minimum
      };

      try {
        const prepared = await client.autofill(payment);
        const signed = wallet.sign(prepared);

        // Use Promise.race with aggressive timeout
        const submitPromise = client.submitAndWait(signed.tx_blob, { timeout: 20000 });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SELL payment timeout after 20s')), 20000)
        );

        const result = await Promise.race([submitPromise, timeoutPromise]);

        if (!result || !result.result) {
          throw new Error('SELL payment returned empty result');
        }

        const engine = result?.result?.engine_result || 'unknown';
        const code = result?.result?.meta?.TransactionResult || engine;
        logger.info(`📄 SELL payment result: engine=${engine}, txResult=${code}`);

        if (code === 'tesSUCCESS') {
          const actualXrp = parseFloat(xrpl.dropsToXrp(result.result.meta.delivered_amount || payment.Amount));
          await recordTrade('SELL', userAddress, actualXrp, wloAmount, discountedPrice);
          logger.info(`✅ SELL payment executed: ${wloAmount} WLO -> ${actualXrp.toFixed(6)} XRP`);
          return { success: true, hash: result.result.hash, xrpAmount: actualXrp, price: discountedPrice };
        }

        throw new Error(`SELL payment failed: ${code || 'unknown'}`);
      } catch (error) {
        logger.error(`❌ SELL payment error: ${error.message}`);
        throw error;
      }
    };

    // For automated trades, use direct payment execution
    if (userAddress === wallet.classicAddress) {
      // Use reasonable sell amounts with Payment transactions
      const sellAmount = Math.min(waldoAmount, 10000); // Max 10k WLO per sell

      logger.info(`🔄 Executing SELL payment: ${sellAmount} WLO (from ${waldoAmount} requested)`);

      try {
        const result = await executeSellPayment(sellAmount);

        // If we have more to sell, schedule additional sells
        if (waldoAmount > sellAmount) {
          const remaining = waldoAmount - sellAmount;
          logger.info(`📋 Remaining ${remaining} WLO will be sold in future trades`);

          // Store remaining amount for future sells
          await redis.set('volume_bot:pending_sell_amount', remaining.toString());
        }

        return result;
      } catch (error) {
        logger.warn(`⚠️ SELL payment failed: ${error.message}`);

        // Fallback: try smaller amount
        const smallerAmount = Math.min(sellAmount, 1000); // Try just 1000 WLO
        logger.info(`🔄 Fallback: trying smaller sell of ${smallerAmount} WLO`);
        try {
          return await executeSellPayment(smallerAmount);
        } catch (fallbackError) {
          logger.error(`❌ Fallback sell also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }
    } else {
      // For user trades, try the original payment approach with very small amounts
      const smallAmount = Math.min(waldoAmount, 500); // Limit user sells to 500 WLO max

      const payment = {
        TransactionType: 'Payment',
        Account: wallet.classicAddress,
        Destination: userAddress,
        Amount: xrpl.xrpToDrops((smallAmount * price * 0.95).toFixed(6)), // 5% discount for quick fill
        SendMax: {
          currency: WALDO_CURRENCY,
          value: parseFloat(smallAmount).toFixed(6),
          issuer: WALDO_ISSUER
        },
        Flags: 0x00020000, // tfPartialPayment
        DeliverMin: xrpl.xrpToDrops((smallAmount * price * 0.50).toFixed(6)) // Accept 50% minimum
      };

      const prepared = await client.autofill(payment);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      const code = result.result?.meta?.TransactionResult;
      if (code === 'tesSUCCESS') {
        const actualXrp = parseFloat(xrpl.dropsToXrp(result.result.meta.delivered_amount || payment.Amount));
        await recordTrade('SELL', userAddress, actualXrp, smallAmount, price);
        return { success: true, hash: result.result.hash, xrpAmount: actualXrp, price };
      }

      throw new Error(`User sell failed: ${code || 'unknown'}`);
    }
  } catch (error) {
    logger.error('❌ Sell WALDO failed:', error);
    return { success: false, error: error.message };
  }
}

// ===== RECORD KEEPING =====
async function recordTrade(type, userAddress, xrpAmount, waldoAmount, price) {
  const trade = {
    type,
    userAddress,
    xrpAmount,
    waldoAmount,
    price,
    timestamp: new Date().toISOString()
  };

  await redis.rPush('waldo:trades', JSON.stringify(trade));
  dailyVolume += xrpAmount;
  await redis.set('waldo:daily_volume', dailyVolume.toString());

  // Determine which bot made the trade based on wallet address
  const isBot2 = userAddress === tradingWallet2?.classicAddress;
  const botId = isBot2 ? 'bot2' : 'bot1';

  // Store data for admin panel (volume bot controls)
  const tradeRecord = {
    type: type,
    amount: parseFloat(waldoAmount.toFixed(6)), // show up to 6 decimals instead of rounding to 0
    currency: 'WLO',
    price: parseFloat(xrpAmount.toFixed(6)),
    timestamp: new Date().toISOString(),
    hash: trade.hash || null,
    bot: botId // Track which bot made the trade
  };

  await redis.lPush('volume_bot:recent_trades', JSON.stringify(tradeRecord));
  logger.info(`📝 Trade stored in Redis [${botId.toUpperCase()}]: ${type} - Recent trades list updated`);

  // Keep only last 50 trades for admin panel
  await redis.lTrim('volume_bot:recent_trades', 0, 49);

  // Update daily counters for admin panel (combined)
  const today = new Date().toISOString().split('T')[0];
  await redis.incr(`volume_bot:trades_${today}`);
  await redis.set('volume_bot:trades_today', await redis.get(`volume_bot:trades_${today}`) || '0');
  await redis.set('volume_bot:volume_24h', dailyVolume.toString());

  // Track per-bot trades
  await redis.incr(`volume_bot:${botId}:trades_${today}`);
  const botTodayTrades = await redis.get(`volume_bot:${botId}:trades_${today}`) || '0';
  await redis.set(`volume_bot:${botId}:trades_today`, botTodayTrades);

  // Update last trade timestamp for admin panel
  await redis.set('volume_bot:last_trade', new Date().toISOString());
  await redis.set(`volume_bot:${botId}:last_trade`, new Date().toISOString());

  logger.info(`📊 Trade recorded [${botId.toUpperCase()}]: ${type} ${waldoAmount} WLO for ${xrpAmount} XRP`);
}

// ===== AUTOMATED MARKET MAKING (Admin-controlled via API) =====

// ===== AUTOMATED MARKET MAKING =====
if (MARKET_MAKING) {
  // Dynamic trading schedule based on admin settings
  // Separate next trade times for each bot to support independent frequencies
  let nextTradeTimeBot1 = Date.now();
  let nextTradeTimeBot2 = Date.now();

  // Check for trades every minute and execute based on frequency settings
  cron.schedule('* * * * *', async () => { // Check every minute
    try {
      // Check admin control status first
      const botStatus = await redis.get('volume_bot:status') || 'running';

      if (botStatus === 'paused' || botStatus === 'emergency_stopped') {
        logger.info(`🛑 Trading paused by admin: ${botStatus}`);
        return;
      }

      // Check if we're in emergency price recovery mode
      const currentPrice = await getCurrentWaldoPrice();
      const emergencyMode = currentPrice < 0.00005;

      // ===== BOT 1 TRADING =====
      if (Date.now() >= nextTradeTimeBot1) {
        // Get Bot 1 frequency setting from Redis (default to 30 minutes)
        const bot1FrequencySetting = await redis.get('volume_bot:frequency') || '30';

        let bot1IntervalMinutes;
        if (bot1FrequencySetting === 'random') {
          // Random interval between 5-45 minutes
          bot1IntervalMinutes = 5 + Math.random() * 40; // 5-45 minutes
          logger.info(`🎲 BOT 1 Random trading interval: ${bot1IntervalMinutes.toFixed(1)} minutes`);
        } else {
          bot1IntervalMinutes = parseInt(bot1FrequencySetting);
        }

        // Set next trade time for Bot 1
        nextTradeTimeBot1 = Date.now() + (bot1IntervalMinutes * 60 * 1000);

        // Store next trade time in Redis for admin panel countdown
        await redis.set('volume_bot:bot1:next_trade_time', nextTradeTimeBot1.toString());

        // Execute trade with probability based on frequency and emergency mode
        let bot1TradeProbability = Math.min(0.8, 30 / bot1IntervalMinutes); // Scale probability inversely with frequency

        if (emergencyMode) {
          bot1TradeProbability = Math.min(0.95, bot1TradeProbability * 3); // 3x higher probability during emergency
        }

        const shouldTradeBot1 = Math.random() < bot1TradeProbability;

        if (shouldTradeBot1) {
          logger.info(`⏰ BOT 1 Executing trade (Frequency: ${bot1FrequencySetting === 'random' ? 'Random' : bot1FrequencySetting + 'min'}, Next: ${new Date(nextTradeTimeBot1).toLocaleTimeString()})`);

          try {
            logger.info('🤖 BOT 1 (Primary): Executing trade...');
            await createAutomatedTrade();
            logger.info('✅ BOT 1 trade executed successfully');
          } catch (error) {
            logger.error('❌ BOT 1 trade error:', error);
          }
        } else {
          logger.info(`⏳ BOT 1 Next trade scheduled for: ${new Date(nextTradeTimeBot1).toLocaleTimeString()} (${bot1FrequencySetting === 'random' ? 'Random' : bot1FrequencySetting + 'min'} interval)`);
        }
      }

      // ===== BOT 2 TRADING =====
      if (tradingWallet2 && Date.now() >= nextTradeTimeBot2) {
        const bot2Enabled = await redis.get('volume_bot:bot2_enabled') !== 'false';
        const bot2Paused = await redis.get('volume_bot:bot2_paused') === 'true';

        if (bot2Enabled && !bot2Paused) {
          // Get Bot 2 frequency setting from Redis (default to 30 minutes)
          const bot2FrequencySetting = await redis.get('volume_bot:bot2_frequency') || '30';

          let bot2IntervalMinutes;
          if (bot2FrequencySetting === 'random') {
            // Random interval between 5-45 minutes
            bot2IntervalMinutes = 5 + Math.random() * 40; // 5-45 minutes
            logger.info(`🎲 BOT 2 Random trading interval: ${bot2IntervalMinutes.toFixed(1)} minutes`);
          } else {
            bot2IntervalMinutes = parseInt(bot2FrequencySetting);
          }

          // Set next trade time for Bot 2
          nextTradeTimeBot2 = Date.now() + (bot2IntervalMinutes * 60 * 1000);

          // Store next trade time in Redis for admin panel countdown
          await redis.set('volume_bot:bot2:next_trade_time', nextTradeTimeBot2.toString());

          // Execute trade with probability based on frequency and emergency mode
          let bot2TradeProbability = Math.min(0.8, 30 / bot2IntervalMinutes); // Scale probability inversely with frequency

          if (emergencyMode) {
            bot2TradeProbability = Math.min(0.95, bot2TradeProbability * 3); // 3x higher probability during emergency
          }

          const shouldTradeBot2 = Math.random() < bot2TradeProbability;

          if (shouldTradeBot2) {
            logger.info(`⏰ BOT 2 Executing trade (Frequency: ${bot2FrequencySetting === 'random' ? 'Random' : bot2FrequencySetting + 'min'}, Next: ${new Date(nextTradeTimeBot2).toLocaleTimeString()})`);

            // Execute with 1 second delay to avoid conflicts
            setTimeout(async () => {
              try {
                logger.info('🤖 BOT 2 (Secondary): Executing trade...');
                await createAutomatedTrade(tradingWallet2);
                logger.info('✅ BOT 2 trade executed successfully');
              } catch (error) {
                logger.error('❌ BOT 2 trade error:', error);
              }
            }, 1000); // 1 second delay
          } else {
            logger.info(`⏳ BOT 2 Next trade scheduled for: ${new Date(nextTradeTimeBot2).toLocaleTimeString()} (${bot2FrequencySetting === 'random' ? 'Random' : bot2FrequencySetting + 'min'} interval)`);
          }
        } else {
          const reason = !bot2Enabled ? 'disabled' : 'paused';
          logger.info(`⏭️ BOT 2 skipped (${reason})`);
        }
      }

      if (emergencyMode) {
        logger.warn(`🚨 EMERGENCY MODE: Increased trade probability for all bots`);
      }

    } catch (error) {
      logger.error('❌ Automated trading error:', error);
    }
  });

  // Price announcements every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await announcePriceUpdate();
    } catch (error) {
      logger.error('❌ Price announcement error:', error);
    }
  });

  // Volume announcements every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await announceVolumeUpdate();
    } catch (error) {
      logger.error('❌ Volume announcement error:', error);
    }
  });

  // Check for profit tracking every hour (always enabled for admin panel)
  cron.schedule(`*/${PROFIT_CHECK_INTERVAL} * * * *`, async () => {
    try {
      await trackProfits();
    } catch (error) {
      logger.error('❌ Profit tracking error:', error);
    }
  });

  // Run profit tracking immediately on startup
  setTimeout(async () => {
    try {
      logger.info('💰 Running initial profit tracking...');
      await trackProfits();
    } catch (error) {
      logger.error('❌ Initial profit tracking error:', error);
    }
  }, 5000); // Wait 5 seconds for XRPL connection to be ready

  // Reset daily volume at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    try {
      await resetDailyStats();
    } catch (error) {
      logger.error('❌ Daily reset error:', error);
    }
  });

  // Update wallet balance every 10 minutes for admin panel
  cron.schedule('*/10 * * * *', async () => {
    try {
      await updateWalletBalance();
    } catch (error) {
      logger.error('❌ Wallet balance update error:', error);
    }
  });

  // Connection health check every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      if (!client.isConnected() && !isReconnecting) {
        logger.warn('⚠️ XRPL client disconnected during health check, triggering reconnection...');
        await connectToNextNode();
      } else if (client.isConnected()) {
        // Test connection with a simple request
        try {
          await client.request({ command: 'server_info' });
          logger.debug('✅ XRPL connection health check passed');
        } catch (testError) {
          logger.warn('⚠️ XRPL connection test failed, triggering reconnection...');
          await connectToNextNode();
        }
      }
    } catch (error) {
      logger.error('❌ Connection health check failed:', error);
    }
  });

  // Process pending micro-sells every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    try {
      await processPendingMicroSells();
    } catch (error) {
      logger.error('❌ Micro-sell processing error:', error);
    }
  });
}

// ===== MICRO-SELL PROCESSING =====
async function processPendingMicroSells() {
  try {
    const pendingAmount = await redis.get('volume_bot:pending_sell_amount');
    if (!pendingAmount || parseFloat(pendingAmount) <= 0) {
      return; // No pending sells
    }

    const remaining = parseFloat(pendingAmount);
    const microAmount = Math.min(remaining, 1000); // Process 1000 WLO at a time

    logger.info(`🔄 Processing pending micro-sell: ${microAmount} WLO (${remaining} remaining)`);

    // Check connection before attempting
    if (!client.isConnected()) {
      logger.warn('⚠️ Client not connected, skipping micro-sell');
      return;
    }

    // Use Payment transaction (same as main SELL function)
    const price = await getCurrentWaldoPrice();
    const discountedPrice = price * 0.95; // 5% below market
    const xrpTarget = parseFloat((microAmount * discountedPrice).toFixed(6));

    const payment = {
      TransactionType: 'Payment',
      Account: tradingWallet.classicAddress,
      Destination: tradingWallet.classicAddress, // Send to self
      Amount: xrpl.xrpToDrops(xrpTarget.toString()), // XRP to receive
      SendMax: { // WLO to send
        currency: WALDO_CURRENCY,
        value: parseFloat(microAmount).toFixed(6),
        issuer: WALDO_ISSUER
      },
      Flags: 0x00020000, // tfPartialPayment
      DeliverMin: xrpl.xrpToDrops((xrpTarget * 0.5).toFixed(6)) // Accept 50% minimum
    };

    // Autofill and submit immediately to avoid LastLedgerSequence expiration
    const prepared = await client.autofill(payment);
    const signed = tradingWallet.sign(prepared);

    // Use Promise.race with 20-second timeout
    const result = await Promise.race([
      client.submitAndWait(signed.tx_blob, { timeout: 20000 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Micro-sell payment timeout after 20s')), 20000)
      )
    ]);

    const code = result.result?.meta?.TransactionResult;
    const engine = result.result?.engine_result;

    logger.info(`📄 Micro-sell payment result: engine=${engine}, txResult=${code}`);

    if (code === 'tesSUCCESS') {
      // Update remaining amount
      const newRemaining = remaining - microAmount;
      if (newRemaining > 0) {
        await redis.set('volume_bot:pending_sell_amount', newRemaining.toString());
        logger.info(`✅ Micro-sell executed: ${microAmount} WLO -> ${xrpTarget} XRP, ${newRemaining} WLO remaining`);
      } else {
        await redis.del('volume_bot:pending_sell_amount');
        logger.info(`✅ Final micro-sell executed: ${microAmount} WLO -> ${xrpTarget} XRP, all pending sells processed`);
      }

      // Record the trade
      await recordTrade('SELL', tradingWallet.classicAddress, xrpTarget, microAmount, discountedPrice);
    } else {
      logger.warn(`⚠️ Micro-sell payment failed: ${code} (engine: ${engine})`);

      // If it's a LastLedgerSequence error, don't retry - just wait for next cron run
      if (engine === 'tefMAX_LEDGER') {
        logger.info('⏭️ LastLedgerSequence expired, will retry on next cron run');
      }
    }
  } catch (error) {
    logger.error('❌ Micro-sell processing failed:', error);

    // If it's a LastLedgerSequence error, log it but don't fail completely
    if (error.message?.includes('LastLedgerSequence')) {
      logger.info('⏭️ LastLedgerSequence expired, will retry on next cron run');
    }
  }
}

// ===== AUTOMATED TRADING FUNCTIONS =====
async function createAutomatedTrade(wallet = tradingWallet) {
  try {
    // Determine which bot this is
    const isBot2 = wallet?.classicAddress === tradingWallet2?.classicAddress;
    const botId = isBot2 ? 'bot2' : 'bot1';

    // Double-check admin control status before executing trade
    const botStatus = await redis.get('volume_bot:status') || 'running';

    if (botStatus === 'paused' || botStatus === 'emergency_stopped') {
      logger.info(`🛑 Trade blocked by admin control: ${botStatus}`);
      return;
    }

    const currentPrice = await getCurrentWaldoPrice();

    // Get admin-controlled trading mode (use bot-specific settings if Bot 2)
    let tradingMode;
    if (isBot2) {
      tradingMode = await redis.get('volume_bot:bot2_trading_mode') || 'automated';
    } else {
      tradingMode = await redis.get('volume_bot:trading_mode') || 'automated';
    }

    // Log the actual trading mode being used (for verification)
    logger.info(`🎛️ ${isBot2 ? 'BOT 2' : 'BOT 1'} Trading Mode: ${tradingMode} (from Redis key: ${isBot2 ? 'volume_bot:bot2_trading_mode' : 'volume_bot:trading_mode'})`);

    const emergencyPriceThreshold = 0.00005; // Below 0.00005 XRP = emergency

    let tradeType;

    // NEW WEIGHTED PERPETUAL TRADING STRATEGY
    // Check current wallet balances to determine optimal trade direction
    const xrpBalance = await getXRPBalance(wallet.classicAddress);
    const wloBalance = await getWLOBalance(wallet.classicAddress);

    // Calculate balance ratios and target allocations
    const wloValueInXrp = wloBalance * currentPrice;
    const totalValueXrp = xrpBalance + wloValueInXrp;
    const xrpRatio = xrpBalance / totalValueXrp;
    const wloRatio = wloValueInXrp / totalValueXrp;

    // Target allocation: maintain roughly 60% XRP, 40% WLO for optimal trading
    const targetXrpRatio = 0.60;
    const targetWloRatio = 0.40;

    logger.info(`💰 Current allocation: ${(xrpRatio * 100).toFixed(1)}% XRP (${xrpBalance.toFixed(2)}), ${(wloRatio * 100).toFixed(1)}% WLO (${wloBalance.toFixed(0)})`);
    logger.info(`🎯 Target allocation: ${(targetXrpRatio * 100).toFixed(1)}% XRP, ${(targetWloRatio * 100).toFixed(1)}% WLO`);

    // Determine trade type based on admin mode and balance weighting
    if (tradingMode === 'buy_only') {
      tradeType = 'BUY';
      logger.info(`🎛️ ADMIN MODE: Buy Only - executing BUY trade`);
    } else if (tradingMode === 'sell_only') {
      tradeType = 'SELL';
      logger.info(`🎛️ ADMIN MODE: Sell Only - executing SELL trade`);
    } else if (tradingMode === 'buy_sell') {
      // Balanced buy & sell mode - favor the side with fewer recent trades
      let buyCount = 0, sellCount = 0;
      try {
        const recent = await redis.lRange('volume_bot:recent_trades', 0, 49);
        for (const item of recent) {
          try {
            const t = JSON.parse(item);
            if (t && t.type === 'BUY') buyCount++;
            else if (t && t.type === 'SELL') sellCount++;
          } catch { }
        }
      } catch (e) {
        logger.warn('⚠️ Could not read recent trades for balancing, falling back to random');
      }
      // If more buys than sells, do a sell to balance. Otherwise do a buy.
      if (buyCount > sellCount) {
        tradeType = 'SELL';
      } else {
        tradeType = 'BUY';
      }
      logger.info(`🎛️ ADMIN MODE: Buy & Sell (balanced) - executing ${tradeType} trade (last50 BUY=${buyCount}, SELL=${sellCount})`);
    } else if (tradingMode === 'automated' || tradingMode === 'perpetual') {
      // PERPETUAL WEIGHTED TRADING MODE

      // Emergency price protection - perpetual trading to recover price
      if (currentPrice < emergencyPriceThreshold) {
        // In emergency, use weighted probability to buy more often (60% buy, 40% sell)
        // This creates upward pressure while still generating volume
        const rand = Math.random();
        tradeType = rand < 0.60 ? 'BUY' : 'SELL';
        logger.warn(`🚨 EMERGENCY: Price ${currentPrice.toFixed(8)} below ${emergencyPriceThreshold} - ${tradeType} trade (60% buy, 40% sell for recovery) [rand=${rand.toFixed(3)}]`);
      }
      // If we have too much XRP (over 70%), favor buying WLO
      else if (xrpRatio > 0.70) {
        tradeType = 'BUY';
        logger.info(`⚖️ REBALANCE: Too much XRP (${(xrpRatio * 100).toFixed(1)}%) - executing BUY to acquire WLO`);
      }
      // If we have too much WLO (over 50%), favor selling some
      else if (wloRatio > 0.50) {
        tradeType = 'SELL';
        logger.info(`⚖️ REBALANCE: Too much WLO (${(wloRatio * 100).toFixed(1)}%) - executing SELL to acquire XRP`);
      }
      // If balances are reasonable, use weighted probability
      else {
        // Calculate trade probability based on how far we are from target
        // (using ratios below to bias probability)

        // PRICE LIFTING STRATEGY: Bias toward BUY orders to help lift WALDO price
        // If XRP is below target, higher chance to sell WLO (get more XRP)
        // If WLO is below target, higher chance to buy WLO
        let buyProbability = 0.65; // Default 65% buy bias for price lifting

        if (xrpRatio < targetXrpRatio) {
          // Need more XRP, so favor selling WLO (but still maintain buy bias)
          buyProbability = 0.45; // 45% buy, 55% sell
        } else if (wloRatio < targetWloRatio) {
          // Need more WLO, so strongly favor buying
          buyProbability = 0.80; // 80% buy, 20% sell (strong price lifting)
        }

        tradeType = Math.random() < buyProbability ? 'BUY' : 'SELL';
        logger.info(`🚀 PRICE LIFTING: ${(buyProbability * 100).toFixed(0)}% buy probability - executing ${tradeType} trade`);
      }
    }

    // GET ADMIN SETTINGS FROM REDIS - RESPECT USER CONTROLS
    // isBot2 already determined above

    let adminMinSize, adminMaxSize;
    if (isBot2) {
      adminMinSize = await redis.get('volume_bot:bot2_min_trade_size');
      adminMaxSize = await redis.get('volume_bot:bot2_max_trade_size');
    } else {
      adminMinSize = await redis.get('volume_bot:min_trade_size');
      adminMaxSize = await redis.get('volume_bot:max_trade_size');
    }

    // ALWAYS respect admin settings from the panel - these are YOUR manual controls
    // Only use fallback defaults if admin hasn't set anything yet
    const baseMinTradeSize = adminMinSize ? parseFloat(adminMinSize) : 0.5;
    const baseMaxTradeSize = adminMaxSize ? parseFloat(adminMaxSize) : 1.0;

    const botLabel = isBot2 ? 'BOT 2' : 'BOT 1';
    logger.info(`🎛️ ${botLabel} Admin Settings: Min=${baseMinTradeSize} XRP, Max=${baseMaxTradeSize} XRP ${adminMinSize ? '(from admin panel)' : '(using defaults)'}`);

    // RESPECT ADMIN PANEL SETTINGS - use your configured min/max directly
    // The trade amount will be randomly selected between YOUR min and max settings
    let minTradeSize = baseMinTradeSize;
    let maxTradeSize = baseMaxTradeSize;

    // Only apply balance-based caps if they would prevent overdraft
    if (tradeType === 'BUY') {
      // Cap at available XRP if balance is lower than max setting
      const availableForTrade = Math.max(0, xrpBalance - 1.0); // Keep 1 XRP for fees
      if (availableForTrade < maxTradeSize) {
        maxTradeSize = Math.max(minTradeSize, availableForTrade);
        logger.info(`💰 BUY capped by balance: ${xrpBalance.toFixed(2)} XRP available, max adjusted to ${maxTradeSize.toFixed(2)}`);
      }
    } else {
      // Cap at available WLO value if balance is lower than max setting
      const availableForTrade = Math.max(0, wloValueInXrp - 0.1); // Keep small WLO reserve
      if (availableForTrade < maxTradeSize) {
        maxTradeSize = Math.max(minTradeSize, availableForTrade);
        logger.info(`💰 SELL capped by balance: ${wloValueInXrp.toFixed(2)} XRP worth of WLO, max adjusted to ${maxTradeSize.toFixed(2)}`);
      }
    }

    logger.info(`🎯 ${botLabel} Trade range: ${minTradeSize.toFixed(2)}-${maxTradeSize.toFixed(2)} XRP (respecting your admin panel settings)`);

    // Calculate random trade amount within YOUR configured min/max range
    let tradeAmount = parseFloat((minTradeSize + Math.random() * (maxTradeSize - minTradeSize)).toFixed(2));

    logger.info(`💰 ${botLabel} Selected trade amount: ${tradeAmount} XRP (randomly chosen from your ${minTradeSize}-${maxTradeSize} range)`);

    // SAFETY CHECKS - ensure minimum reserves for fees and future trades
    const minXrpReserve = 1.0; // Keep at least 1 XRP for fees
    const minWloReserve = 100; // Keep at least 100 WLO for future trades

    // In emergency mode, relax the reserve requirements slightly
    const isEmergency = currentPrice < emergencyPriceThreshold;
    const requiredXrpReserve = isEmergency ? 0.5 : minXrpReserve;
    const requiredWloReserve = isEmergency ? 50 : minWloReserve;

    if (tradeType === 'BUY' && xrpBalance < (tradeAmount + requiredXrpReserve)) {
      logger.warn(`⚠️ Insufficient XRP for safe trading: ${xrpBalance.toFixed(2)} XRP, need ${(tradeAmount + requiredXrpReserve).toFixed(2)} XRP`);
      logger.info(`🛡️ SAFETY: Skipping BUY trade to preserve XRP reserves`);
      return;
    }

    if (tradeType === 'SELL' && wloBalance < requiredWloReserve) {
      logger.warn(`⚠️ Insufficient WLO for safe trading: ${wloBalance.toFixed(0)} WLO, need at least ${requiredWloReserve} WLO`);
      logger.info(`🛡️ SAFETY: Skipping SELL trade to preserve WLO reserves`);
      return;
    }

    let message = '';

    if (tradeType === 'BUY') {
      // Safety check: prevent zero or invalid price
      if (currentPrice <= 0 || isNaN(currentPrice) || !isFinite(currentPrice)) {
        logger.error('❌ Invalid price for automated trade, skipping');
        return;
      }

      const waldoAmount = (tradeAmount / currentPrice) * (1 - PRICE_SPREAD / 100);

      // Safety check: prevent infinite amounts
      if (!isFinite(waldoAmount) || waldoAmount <= 0) {
        logger.error('❌ Invalid WALDO amount calculation, skipping trade');
        return;
      }

      if (STEALTH_MODE) {
        // Natural looking personal message
        const naturalMessages = [
          `Just picked up ${waldoAmount.toFixed(0)} more WALDO for ${tradeAmount} XRP 💰`,
          `Added ${waldoAmount.toFixed(0)} WLO to my bag at ${currentPrice.toFixed(8)} XRP 🎯`,
          `Bought the dip - ${tradeAmount} XRP worth of WALDO 📈`,
          `Loading up on WALDO - ${waldoAmount.toFixed(0)} WLO secured 🚀`,
          `Another ${tradeAmount} XRP into WALDO, feeling bullish 💪`
        ];
        message = naturalMessages[Math.floor(Math.random() * naturalMessages.length)];
      } else {
        message = `🟢 **Buy Order**\n\n` +
          `💰 **Purchased**: ${waldoAmount.toFixed(0)} WLO\n` +
          `💸 **Cost**: ${tradeAmount} XRP\n` +
          `📊 **Price**: ${currentPrice.toFixed(8)} XRP per WLO`;
      }

      // Check XRP balance before buying
      const xrpBalance = await getXRPBalance(wallet.classicAddress);
      // In emergency mode, only require 0.1 XRP for fees; otherwise require 1 XRP
      const feeBuffer = currentPrice < emergencyPriceThreshold ? 0.1 : 1.0;
      if (xrpBalance < tradeAmount + feeBuffer) {
        logger.warn(`⚠️ Insufficient XRP balance: ${xrpBalance} XRP, need ${tradeAmount + feeBuffer} XRP`);
        return;
      }

      // Execute REAL BUY trade on XRPL
      try {
        logger.info(`🔄 Executing REAL BUY trade: ${tradeAmount} XRP for ${waldoAmount.toFixed(0)} WLO`);
        const result = await buyWaldo(wallet.classicAddress, tradeAmount, wallet);
        if (result.success) {
          logger.info(`✅ REAL BUY executed: ${result.hash}`);
          message += `\n🔗 TX: ${result.hash}`;
        } else {
          logger.error(`❌ REAL BUY failed: ${result.error}`);
          return; // Skip posting if trade failed
        }
      } catch (error) {
        logger.error(`❌ REAL BUY error: ${error.message}`);
        return; // Skip posting if trade failed
      }

    } else {
      // Safety check: prevent zero or invalid price
      if (currentPrice <= 0 || isNaN(currentPrice) || !isFinite(currentPrice)) {
        logger.error('❌ Invalid price for automated trade, skipping');
        return;
      }

      // Use admin-selected tradeAmount as target XRP to receive
      const xrpAmount = parseFloat(tradeAmount.toFixed(6));
      const waldoAmount = Math.max(1, Math.floor(xrpAmount / (currentPrice * (1 - PRICE_SPREAD / 100))));

      // Safety check: prevent zero amounts
      if (!isFinite(xrpAmount) || xrpAmount <= 0 || !isFinite(waldoAmount) || waldoAmount <= 0) {
        logger.error('❌ Invalid SELL amount calculation, skipping trade');
        return;
      }

      if (STEALTH_MODE) {
        // Natural looking personal message
        const naturalMessages = [
          `Took some profits - sold ${waldoAmount.toFixed(0)} WALDO for ${xrpAmount.toFixed(2)} XRP 💸`,
          `Trimmed my WALDO position, ${xrpAmount.toFixed(2)} XRP secured 📊`,
          `Sold ${waldoAmount.toFixed(0)} WLO at good price ${currentPrice.toFixed(8)} XRP 🎯`,
          `Taking profits on WALDO - ${xrpAmount.toFixed(2)} XRP out 💰`,
          `Reduced WALDO holdings by ${waldoAmount.toFixed(0)} tokens 📉`
        ];
        message = naturalMessages[Math.floor(Math.random() * naturalMessages.length)];
      } else {
        message = `🔴 **Sell Order**\n\n` +
          `💸 **Sold**: ${waldoAmount.toFixed(0)} WLO\n` +
          `💰 **Received**: ${xrpAmount.toFixed(4)} XRP\n` +
          `📊 **Price**: ${currentPrice.toFixed(8)} XRP per WLO`;
      }

      // Check WLO balance before selling
      const wloBalance = await getWLOBalance(wallet.classicAddress);
      if (wloBalance < waldoAmount) {
        logger.warn(`⚠️ Insufficient WLO balance: ${wloBalance} WLO, need ${waldoAmount} WLO`);
        return;
      }

      // Execute REAL SELL trade on XRPL
      try {
        logger.info(`🔄 Executing REAL SELL trade: ${waldoAmount} WLO for ${xrpAmount.toFixed(4)} XRP [${isBot2 ? 'BOT 2' : 'BOT 1'}]`);
        const result = await sellWaldo(wallet.classicAddress, waldoAmount, wallet);
        if (result.success) {
          logger.info(`✅ REAL SELL executed: ${result.hash} [${isBot2 ? 'BOT 2' : 'BOT 1'}]`);
          message += `\n🔗 TX: ${result.hash}`;
        } else {
          logger.error(`❌ REAL SELL failed: ${result.error} [${isBot2 ? 'BOT 2' : 'BOT 1'}]`);
          return; // Skip posting if trade failed
        }
      } catch (error) {
        logger.error(`❌ REAL SELL error: ${error.message} [${isBot2 ? 'BOT 2' : 'BOT 1'}]`);
        return; // Skip posting if trade failed
      }
    }

    logger.info(`🤖 Automated ${tradeType} trade created: ${tradeAmount} XRP`);

  } catch (error) {
    logger.error('❌ Automated trade creation failed:', error);
    throw error;
  }
}

async function announcePriceUpdate() {
  try {
    const price = await getCurrentWaldoPrice();
    const volume = await redis.get('waldo:daily_volume') || '0';
    const tradesCount = await redis.lLen('waldo:trades');

    // Calculate price change (simulate for now)
    const priceChange = (Math.random() - 0.5) * 10; // -5% to +5%
    const changeEmoji = priceChange >= 0 ? '📈' : '📉';

    let message = '';

    if (STEALTH_MODE) {
      // Natural looking personal observations
      const naturalUpdates = [
        `WALDO holding steady at ${price.toFixed(8)} XRP ${changeEmoji}`,
        `Nice volume on WALDO today - ${parseFloat(volume).toFixed(0)} XRP traded 📊`,
        `WALDO price action looking good ${changeEmoji} ${price.toFixed(8)} XRP`,
        `Solid trading activity on WLO - ${tradesCount} trades today 💪`,
        `WALDO market depth improving, good liquidity at ${price.toFixed(8)} XRP 🎯`
      ];
      message = naturalUpdates[Math.floor(Math.random() * naturalUpdates.length)];
    } else {
      message = `${changeEmoji} **WALDO Update**\n\n` +
        `💰 **Price**: ${price.toFixed(8)} XRP per WLO\n` +
        `📊 **24h Volume**: ${parseFloat(volume).toFixed(2)} XRP\n` +
        `🔄 **Trades**: ${tradesCount}`;
    }

    logger.info('📊 Price update prepared');

  } catch (error) {
    logger.error('❌ Price announcement failed:', error);
  }
}

async function announceVolumeUpdate() {
  try {
    const volume = await redis.get('waldo:daily_volume') || '0';
    const tradesCount = await redis.lLen('waldo:trades');
    const price = currentPrice;

    // Generate volume milestone messages
    const volumeNum = parseFloat(volume);
    let milestone = '';

    if (volumeNum >= 1000) milestone = '🚀 **1000+ XRP Volume Milestone!**';
    else if (volumeNum >= 500) milestone = '🎯 **500+ XRP Volume Milestone!**';
    else if (volumeNum >= 100) milestone = '💪 **100+ XRP Volume Milestone!**';
    else if (volumeNum >= 50) milestone = '📈 **50+ XRP Volume Milestone!**';

    const message = `📊 **WALDO Trading Summary**\n\n` +
      `${milestone ? milestone + '\n\n' : ''}` +
      `💰 **24h Volume**: ${volumeNum.toFixed(2)} XRP\n` +
      `🔄 **Total Trades**: ${tradesCount}\n` +
      `📊 **Current Price**: ${price.toFixed(8)} XRP per WLO\n` +
      `⚡ **Active Traders**: ${Math.floor(tradesCount / 3) + 1}\n` +
      `🤖 **Market Making**: Active\n\n` +
      `🎯 **Trade WALDO**: Use @WALDOTradingBot\n` +
      `💬 **Join Community**: @waldocoin`;

    logger.info(`📈 Volume update announced: ${volumeNum.toFixed(2)} XRP`);

  } catch (error) {
    logger.error('❌ Volume announcement failed:', error);
  }
}

// ===== WALLET BALANCE FUNCTIONS =====
async function updateWalletBalance() {
  try {
    if (STEALTH_MODE) {
      await redis.set('volume_bot:wallet_balance', 'Stealth Mode - Balance Hidden');
      return;
    }

    // Get Bot 1 wallet balance from XRPL
    if (!tradingWallet || !client.isConnected()) {
      await redis.set('volume_bot:wallet_balance', 'Wallet not connected');
      return;
    }

    // Update Bot 1 balance
    const accountInfo1 = await client.request({
      command: 'account_info',
      account: tradingWallet.classicAddress
    });

    const xrpBalance1 = parseFloat(accountInfo1.result.account_data.Balance) / 1000000;

    // Get WLO balance for Bot 1
    const accountLines1 = await client.request({
      command: 'account_lines',
      account: tradingWallet.classicAddress
    });

    let waldoBalance1 = 0;
    if (accountLines1.result.lines) {
      const waldoLine = accountLines1.result.lines.find(line =>
        line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
      );
      if (waldoLine) {
        waldoBalance1 = Math.abs(parseFloat(waldoLine.balance)); // Use absolute value
      }
    }

    // Store Bot 1 balances
    await redis.set('volume_bot:bot1:xrp_balance', xrpBalance1.toFixed(4));
    await redis.set('volume_bot:bot1:wlo_balance', waldoBalance1.toFixed(0));

    const balanceString1 = `${xrpBalance1.toFixed(2)} XRP + ${waldoBalance1.toFixed(0)} WLO`;
    await redis.set('volume_bot:bot1:wallet_balance', balanceString1);

    logger.info(`💰 Bot 1 balance updated: ${balanceString1}`);

    // Update Bot 2 balance if available
    if (tradingWallet2) {
      const accountInfo2 = await client.request({
        command: 'account_info',
        account: tradingWallet2.classicAddress
      });

      const xrpBalance2 = parseFloat(accountInfo2.result.account_data.Balance) / 1000000;

      // Get WLO balance for Bot 2
      const accountLines2 = await client.request({
        command: 'account_lines',
        account: tradingWallet2.classicAddress
      });

      let waldoBalance2 = 0;
      if (accountLines2.result.lines) {
        const waldoLine = accountLines2.result.lines.find(line =>
          line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
        );
        if (waldoLine) {
          waldoBalance2 = Math.abs(parseFloat(waldoLine.balance)); // Use absolute value
        }
      }

      // Store Bot 2 balances
      await redis.set('volume_bot:bot2:xrp_balance', xrpBalance2.toFixed(4));
      await redis.set('volume_bot:bot2:wlo_balance', waldoBalance2.toFixed(0));

      const balanceString2 = `${xrpBalance2.toFixed(2)} XRP + ${waldoBalance2.toFixed(0)} WLO`;
      await redis.set('volume_bot:bot2:wallet_balance', balanceString2);

      logger.info(`💰 Bot 2 balance updated: ${balanceString2}`);
    }

    // Store combined balance for backward compatibility
    await redis.set('volume_bot:xrp_balance', (parseFloat(xrpBalance1.toFixed(4)) + (tradingWallet2 ? parseFloat((await redis.get('volume_bot:bot2:xrp_balance') || '0')) : 0)).toFixed(4));
    await redis.set('volume_bot:wlo_balance', (parseFloat(waldoBalance1.toFixed(0)) + (tradingWallet2 ? parseFloat((await redis.get('volume_bot:bot2:wlo_balance') || '0')) : 0)).toFixed(0));

  } catch (error) {
    logger.error('❌ Error updating wallet balance:', error);
    await redis.set('volume_bot:wallet_balance', 'Error loading balance');
  }
}

// ===== DAILY STATS RESET =====
async function resetDailyStats() {
  try {
    // Archive yesterday's data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Archive current stats
    const currentVolume = await redis.get('waldo:daily_volume') || '0';
    const currentTrades = await redis.lLen('waldo:trades');

    await redis.set(`waldo:archive:${dateKey}:volume`, currentVolume);
    await redis.set(`waldo:archive:${dateKey}:trades`, currentTrades.toString());

    // Reset daily counters
    dailyVolume = 0;
    await redis.set('waldo:daily_volume', '0');

    // Keep only last 100 trades (don't delete all history)
    const totalTrades = await redis.lLen('waldo:trades');
    if (totalTrades > 100) {
      await redis.ltrim('waldo:trades', -100, -1); // Keep last 100
    }

    logger.info(`🔄 Daily stats reset - Archived ${currentVolume} XRP volume, ${currentTrades} trades`);

    // Announce new day
  } catch (error) {
    logger.error('❌ Daily reset failed:', error);
  }
}

// ===== PROFIT MANAGEMENT =====
async function trackProfits() {
  // Always track profits - this is essential for the admin panel
  try {
    // Get combined balance from both bots
    let bot1XrpBalance = 0;
    let bot2XrpBalance = 0;

    if (tradingWallet && client.isConnected()) {
      // Get Bot 1 balance
      const accountInfo1 = await client.request({
        command: 'account_info',
        account: tradingWallet.classicAddress,
        ledger_index: 'validated'
      });
      bot1XrpBalance = parseFloat(xrpl.dropsToXrp(accountInfo1.result.account_data.Balance));

      // Get Bot 2 balance if available
      if (tradingWallet2) {
        const accountInfo2 = await client.request({
          command: 'account_info',
          account: tradingWallet2.classicAddress,
          ledger_index: 'validated'
        });
        bot2XrpBalance = parseFloat(xrpl.dropsToXrp(accountInfo2.result.account_data.Balance));
      }
    } else {
      // In stealth mode, simulate balance tracking
      const storedBalance = await redis.get('waldo:simulated_balance') || STARTING_BALANCE.toString();
      bot1XrpBalance = parseFloat(storedBalance);
    }

    // Calculate combined balance and profit
    const currentBalance = bot1XrpBalance + bot2XrpBalance;

    // Get starting balance from Redis (set by admin panel reset)
    const startingBalanceFromRedis = await redis.get('volume_bot:starting_balance');
    const effectiveStartingBalance = startingBalanceFromRedis ? parseFloat(startingBalanceFromRedis) : STARTING_BALANCE;

    const totalProfit = currentBalance - effectiveStartingBalance;

    // Store profit data using volume_bot: prefix to match admin panel expectations
    await redis.set('volume_bot:current_balance', currentBalance.toString());
    await redis.set('volume_bot:total_profit', totalProfit.toString());

    // Also store in legacy keys for backward compatibility
    await redis.set('waldo:current_balance', currentBalance.toString());
    await redis.set('waldo:total_profit', totalProfit.toString());

    // Check if we should reserve some profits
    if (currentBalance > PROFIT_RESERVE_THRESHOLD) {
      const excessAmount = currentBalance - effectiveStartingBalance;
      const reserveAmount = (excessAmount * PROFIT_RESERVE_PERCENTAGE) / 100;

      // Record profit reserve (conceptual - money stays in wallet)
      await recordProfitReserve(reserveAmount);
    }

    // Check if we should skim profits to the profit wallet
    if (PROFIT_SKIM_ENABLED && totalProfit > PROFIT_SKIM_THRESHOLD) {
      await skimProfits(totalProfit, bot1XrpBalance, bot2XrpBalance, effectiveStartingBalance);
    }

    // Log current status
    logger.info(`💰 Combined balance: ${currentBalance.toFixed(4)} XRP (Bot1: ${bot1XrpBalance.toFixed(4)}, Bot2: ${bot2XrpBalance.toFixed(4)}) | Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} XRP`);

  } catch (error) {
    logger.error('❌ Error tracking profits:', error);
  }
}

async function recordProfitReserve(amount) {
  try {
    // Record profit reserve (conceptual - money stays in wallet)
    const reserve = {
      amount: amount,
      timestamp: new Date().toISOString(),
      type: 'profit_reserve',
      note: 'Profits set aside for future use'
    };

    await redis.rPush('waldo:profit_reserves', JSON.stringify(reserve));

    // Update total reserved profits
    const currentReserved = await redis.get('waldo:total_reserved') || '0';
    const newReserved = parseFloat(currentReserved) + amount;
    await redis.set('waldo:total_reserved', newReserved.toString());

    logger.info(`💎 Profit reserved: ${amount.toFixed(4)} XRP (Total reserved: ${newReserved.toFixed(4)} XRP)`);

    return {
      success: true,
      amount: amount,
      totalReserved: newReserved
    };
  } catch (error) {
    logger.error('❌ Profit reserve failed:', error);
    return { success: false, error: error.message };
  }
}

async function skimProfits(totalProfit, bot1Balance, bot2Balance, startingBalance) {
  try {
    // Check if we've already skimmed recently (prevent multiple skims in short time)
    const lastSkimTime = await redis.get('volume_bot:last_skim_time');
    if (lastSkimTime) {
      const timeSinceLastSkim = Date.now() - parseInt(lastSkimTime);
      const minTimeBetweenSkims = 60 * 60 * 1000; // 1 hour minimum between skims
      if (timeSinceLastSkim < minTimeBetweenSkims) {
        logger.info(`⏳ Profit skim skipped - last skim was ${Math.round(timeSinceLastSkim / 60000)} minutes ago`);
        return;
      }
    }

    // Calculate how much to skim (percentage of profit)
    const skimAmount = totalProfit * (PROFIT_SKIM_PERCENTAGE / 100);

    // Make sure we don't skim too much - keep minimum balance in each bot
    const totalMinBalance = MIN_BOT_BALANCE * (tradingWallet2 ? 2 : 1);
    const maxSkimAmount = (bot1Balance + bot2Balance) - totalMinBalance;

    const actualSkimAmount = Math.min(skimAmount, maxSkimAmount);

    if (actualSkimAmount < 1) {
      logger.info(`💰 Profit skim amount too small: ${actualSkimAmount.toFixed(4)} XRP - skipping`);
      return;
    }

    logger.info(`💸 Initiating profit skim: ${actualSkimAmount.toFixed(4)} XRP (${PROFIT_SKIM_PERCENTAGE}% of ${totalProfit.toFixed(4)} XRP profit) to ${PROFIT_SKIM_WALLET}`);

    // Determine which bot to skim from (prefer the one with more balance)
    let skimFromBot1 = 0;
    let skimFromBot2 = 0;

    if (tradingWallet2) {
      // Split skim proportionally based on balances
      const totalBalance = bot1Balance + bot2Balance;
      skimFromBot1 = Math.min(actualSkimAmount * (bot1Balance / totalBalance), bot1Balance - MIN_BOT_BALANCE);
      skimFromBot2 = Math.min(actualSkimAmount - skimFromBot1, bot2Balance - MIN_BOT_BALANCE);

      // Adjust if one bot can't contribute enough
      if (skimFromBot1 < 0) {
        skimFromBot2 = actualSkimAmount;
        skimFromBot1 = 0;
      }
      if (skimFromBot2 < 0) {
        skimFromBot1 = actualSkimAmount;
        skimFromBot2 = 0;
      }
    } else {
      skimFromBot1 = actualSkimAmount;
    }

    let totalSkimmed = 0;

    // Skim from Bot 1 if needed
    if (skimFromBot1 > 0.1) {
      const bot1Skim = await sendXrpPayment(tradingWallet, PROFIT_SKIM_WALLET, skimFromBot1, 'BOT1');
      if (bot1Skim.success) {
        totalSkimmed += skimFromBot1;
        logger.info(`✅ Bot 1 skimmed ${skimFromBot1.toFixed(4)} XRP to profit wallet`);
      }
    }

    // Skim from Bot 2 if needed
    if (skimFromBot2 > 0.1 && tradingWallet2) {
      const bot2Skim = await sendXrpPayment(tradingWallet2, PROFIT_SKIM_WALLET, skimFromBot2, 'BOT2');
      if (bot2Skim.success) {
        totalSkimmed += skimFromBot2;
        logger.info(`✅ Bot 2 skimmed ${skimFromBot2.toFixed(4)} XRP to profit wallet`);
      }
    }

    if (totalSkimmed > 0) {
      // Record the skim
      await redis.set('volume_bot:last_skim_time', Date.now().toString());
      await redis.set('volume_bot:last_skim_amount', totalSkimmed.toString());

      // Update total skimmed
      const totalSkimmedSoFar = await redis.get('volume_bot:total_skimmed') || '0';
      const newTotalSkimmed = parseFloat(totalSkimmedSoFar) + totalSkimmed;
      await redis.set('volume_bot:total_skimmed', newTotalSkimmed.toString());

      logger.info(`💰 PROFIT SKIM COMPLETE: ${totalSkimmed.toFixed(4)} XRP sent to ${PROFIT_SKIM_WALLET} | Total skimmed: ${newTotalSkimmed.toFixed(4)} XRP`);

      // Reset starting balance to current balance after skim
      const newStartingBalance = (bot1Balance - skimFromBot1) + (bot2Balance - skimFromBot2);
      await redis.set('volume_bot:starting_balance', newStartingBalance.toString());
      logger.info(`📊 Starting balance reset to ${newStartingBalance.toFixed(4)} XRP after skim`);
    }

  } catch (error) {
    logger.error('❌ Profit skim failed:', error);
  }
}

async function sendXrpPayment(fromWallet, toAddress, amount, botLabel) {
  try {
    const payment = {
      TransactionType: 'Payment',
      Account: fromWallet.classicAddress,
      Destination: toAddress,
      Amount: xrpl.xrpToDrops(amount.toString())
    };

    const prepared = await client.autofill(payment);
    const signed = fromWallet.sign(prepared);

    logger.info(`📤 ${botLabel} sending ${amount.toFixed(4)} XRP to ${toAddress}...`);

    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      logger.info(`✅ ${botLabel} payment successful: ${amount.toFixed(4)} XRP sent`);
      return { success: true, amount };
    } else {
      logger.error(`❌ ${botLabel} payment failed:`, result.result.meta.TransactionResult);
      return { success: false, error: result.result.meta.TransactionResult };
    }
  } catch (error) {
    logger.error(`❌ ${botLabel} payment error:`, error);
    return { success: false, error: error.message };
  }
}

// ===== WALLET MANAGEMENT =====
// Removed: getUserWallet and setUserWallet (Telegram bot functions)

// ===== REMOVED: TELEGRAM BOT COMMANDS =====
// All Telegram bot commands have been removed
// Bot is now controlled via admin panel API only

// ===== STARTUP =====
async function startBot() {
  logger.info('🚀 Starting WALDO Trading Bot...');

  // Connect to Redis first
  const redisConnected = await connectRedis();
  if (!redisConnected) {
    logger.error('❌ Failed to connect to Redis - exiting');
    process.exit(1);
  }

  const xrplConnected = await connectXRPL();
  if (!xrplConnected) {
    logger.error('❌ Failed to connect to XRPL - exiting');
    process.exit(1);
  }

  await getCurrentWaldoPrice();
  logger.info(`💰 Initial WALDO price: ${currentPrice.toFixed(8)} XRP`);

  // Update wallet balance for admin panel
  await updateWalletBalance();

  // Show which bots are configured
  logger.info('🤖 ========== BOT CONFIGURATION ==========');
  logger.info(`✅ Bot 1 (Primary): ${tradingWallet?.classicAddress}`);
  if (tradingWallet2) {
    logger.info(`✅ Bot 2 (Secondary): ${tradingWallet2.classicAddress}`);
  } else {
    logger.info('❌ Bot 2: NOT CONFIGURED');
  }
  logger.info('🤖 ========================================');

  logger.info('✅ WALDO Trading Bot is running!');
}

// ===== ERROR HANDLING =====
process.on('unhandledRejection', (error) => {
  logger.error('❌ Unhandled rejection:', error);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Shutting down gracefully...');
  await client.disconnect();
  await redis.quit();
  process.exit(0);
});

// ===== START THE BOT =====
startBot().catch(console.error);
