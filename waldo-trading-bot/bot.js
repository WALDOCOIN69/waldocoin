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
  'wss://xrplcluster.com',
  'wss://s1.ripple.com',
  'wss://s2.ripple.com',
  'wss://xrpl.ws'
];
const XRPL_NODE = process.env.XRPL_NODE || XRPL_NODES[0];
const TRADING_WALLET_SECRET = process.env.TRADING_WALLET_SECRET;
const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WALDO_CURRENCY = process.env.WALDO_CURRENCY || 'WLO';
const STEALTH_MODE = process.env.STEALTH_MODE === 'true';

// ===== PROFIT MANAGEMENT CONFIGURATION =====
const PROFIT_TRACKING = process.env.PROFIT_TRACKING_ENABLED === 'true';
const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE_XRP) || 70;
const PROFIT_RESERVE_THRESHOLD = parseFloat(process.env.PROFIT_RESERVE_THRESHOLD) || 200;
const PROFIT_RESERVE_PERCENTAGE = parseFloat(process.env.PROFIT_RESERVE_PERCENTAGE) || 50;
const PROFIT_CHECK_INTERVAL = parseInt(process.env.PROFIT_CHECK_INTERVAL) || 60;

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
    setTimeout(() => connectToNextNode(), 2000);
  });

  client.on('disconnected', (code) => {
    logger.warn(`XRPL disconnected: ${code}`);
    // Immediate reconnection for unexpected disconnects
    setTimeout(() => connectToNextNode(), 1000);
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
    logger.info(`🔗 Connected to XRPL - Trading wallet: ${tradingWallet.classicAddress}`);
    logger.info(`🪙 WALDO token configured: currency=${WALDO_CURRENCY} issuer=${WALDO_ISSUER}`);

    // Ensure WLO trustline exists and is sufficient
    try {
      await ensureWLOTrustline();
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
async function ensureWLOTrustline() {
  try {
    if (STEALTH_MODE) return;
    if (!tradingWallet || !client.isConnected()) return;

    // Check existing trustlines
    const lines = await client.request({
      command: 'account_lines',
      account: tradingWallet.classicAddress,
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
      Account: tradingWallet.classicAddress,
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

    return wloLine ? parseFloat(wloLine.balance) : 0;
  } catch (error) {
    logger.error('❌ Error getting WLO balance:', error);
    return 0;
  }
}

// ===== TRADING FUNCTIONS =====
async function buyWaldo(userAddress, xrpAmount) {
  try {
    // Ensure XRPL connection is active before attempting trade
    if (!client.isConnected() && !isReconnecting) {
      logger.warn('⚠️ XRPL client disconnected, attempting robust reconnection...');
      const connected = await connectToNextNode();
      if (!connected) {
        throw new Error('Failed to establish XRPL connection for buy trade');
      }
    }
    // Read admin-configured min/max from Redis (fallback to defaults)
    const adminMinRaw = await redis.get('volume_bot:min_trade_size');
    const adminMaxRaw = await redis.get('volume_bot:max_trade_size');
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
        Account: tradingWallet.classicAddress,
        Destination: userAddress,
        Amount: { currency: WALDO_CURRENCY, value: wantAmount.toFixed(6), issuer: WALDO_ISSUER },
        SendMax: xrpl.xrpToDrops(amountXrp.toString()),
        Flags: 0x00020000, // tfPartialPayment
        DeliverMin: { currency: WALDO_CURRENCY, value: deliverMinVal.toFixed(6), issuer: WALDO_ISSUER }
      };
      if (bestPaths) payment.Paths = bestPaths;

      const prepared = await client.autofill(payment);
      const signed = tradingWallet.sign(prepared);
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
      if ((e1.message || '').includes('tecPATH_PARTIAL')) {
        logger.warn('⚠️ tecPATH_PARTIAL on buy - retrying with smaller amount and lower DeliverMin');

        // 1) Try ~75% of the original, clamped by admin min
        const mid = Math.max(effectiveMin, parseFloat((xrpAmount * 0.75).toFixed(2)));
        if (mid < xrpAmount) {
          try { return await attempt(mid, 0.25); } catch (e2) { }
        }

        // 2) Try ~50% of the original, clamped by admin min
        const half = Math.max(effectiveMin, parseFloat((xrpAmount * 0.50).toFixed(2)));
        if (half < xrpAmount) {
          try { return await attempt(half, 0.15); } catch (e3) { }
        }

        // 3) If large enough, split into two sequential half orders (best chance on thin books)
        if (xrpAmount >= 2 * effectiveMin) {
          const part = Math.max(effectiveMin, parseFloat((xrpAmount / 2).toFixed(2)));
          try {
            const first = await attempt(part, 0.15);
            try { await attempt(part, 0.15); } catch (_) { }
            return first;
          } catch (_) { }
        }

        // 4) Final attempt with admin minimum and very low DeliverMin
        if (effectiveMin < xrpAmount) {
          return await attempt(effectiveMin, 0.05);
        }
      }
      throw e1;
    }
  } catch (error) {
    logger.error('❌ Buy WALDO failed:', error);
    return { success: false, error: error.message };
  }
}

async function sellWaldo(userAddress, waldoAmount) {
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

    // NEW APPROACH: Create passive sell offers instead of immediate execution
    // This places orders on the book that buyers can fill gradually
    const createPassiveSellOffer = async (wloAmount) => {
      // Calculate slightly below market price to encourage fills
      const discountedPrice = price * 0.98; // 2% below market for quick fills
      const xrpTarget = parseFloat((wloAmount * discountedPrice).toFixed(6));

      if (!isFinite(xrpTarget) || xrpTarget <= 0) {
        throw new Error('Invalid trade amount calculation');
      }

      const offer = {
        TransactionType: 'OfferCreate',
        Account: tradingWallet.classicAddress,
        TakerGets: xrpl.xrpToDrops(xrpTarget.toString()), // XRP we want to receive
        TakerPays: { // WLO we're offering to sell
          currency: WALDO_CURRENCY,
          value: parseFloat(wloAmount).toFixed(6),
          issuer: WALDO_ISSUER
        },
        Flags: 0x00000001 | 0x00010000, // tfSell | tfPassive
        Expiration: Math.floor(Date.now() / 1000) + (60 * 60) // Expires in 1 hour
      };

      const prepared = await client.autofill(offer);
      const signed = tradingWallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      const code = result.result?.meta?.TransactionResult;
      if (code === 'tesSUCCESS') {
        // Record the trade even if it's a passive offer
        await recordTrade('SELL', userAddress, xrpTarget, wloAmount, discountedPrice);
        logger.info(`✅ Passive sell offer created: ${wloAmount} WLO at ${discountedPrice.toFixed(8)} XRP each`);
        return { success: true, hash: result.result.hash, xrpAmount: xrpTarget, price: discountedPrice };
      }

      throw new Error(`Passive offer failed: ${code || 'unknown'}`);
    };

    // For automated trades, use micro-sells approach
    if (userAddress === tradingWallet.classicAddress) {
      // Break large sells into tiny amounts that are more likely to fill
      const microSellAmount = Math.min(waldoAmount, 1000); // Max 1000 WLO per micro-sell

      logger.info(`🔄 Creating micro-sell offer: ${microSellAmount} WLO (from ${waldoAmount} requested)`);

      try {
        const result = await createPassiveSellOffer(microSellAmount);

        // If we have more to sell, schedule additional micro-sells
        if (waldoAmount > microSellAmount) {
          const remaining = waldoAmount - microSellAmount;
          logger.info(`📋 Remaining ${remaining} WLO will be sold in future micro-sells`);

          // Store remaining amount for future micro-sells
          await redis.set('volume_bot:pending_sell_amount', remaining.toString());
        }

        return result;
      } catch (error) {
        logger.warn(`⚠️ Micro-sell failed: ${error.message}`);

        // Fallback: try even smaller amount
        const tinyAmount = Math.min(microSellAmount, 100); // Try just 100 WLO
        logger.info(`🔄 Fallback: trying tiny sell of ${tinyAmount} WLO`);
        return await createPassiveSellOffer(tinyAmount);
      }
    } else {
      // For user trades, try the original payment approach with very small amounts
      const smallAmount = Math.min(waldoAmount, 500); // Limit user sells to 500 WLO max

      const payment = {
        TransactionType: 'Payment',
        Account: tradingWallet.classicAddress,
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
      const signed = tradingWallet.sign(prepared);
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

  // Store data for admin panel (volume bot controls)
  await redis.lPush('volume_bot:recent_trades', JSON.stringify({
    type: type,
    amount: parseFloat(waldoAmount.toFixed(6)), // show up to 6 decimals instead of rounding to 0
    currency: 'WLO',
    price: parseFloat(xrpAmount.toFixed(6)),
    timestamp: new Date().toISOString(),
    hash: trade.hash || null
  }));

  // Keep only last 50 trades for admin panel
  await redis.lTrim('volume_bot:recent_trades', 0, 49);

  // Update daily counters for admin panel
  const today = new Date().toISOString().split('T')[0];
  await redis.incr(`volume_bot:trades_${today}`);
  await redis.set('volume_bot:trades_today', await redis.get(`volume_bot:trades_${today}`) || '0');
  await redis.set('volume_bot:volume_24h', dailyVolume.toString());

  // Update last trade timestamp for admin panel
  await redis.set('volume_bot:last_trade', new Date().toISOString());

  logger.info(`📊 Trade recorded: ${type} ${waldoAmount} WLO for ${xrpAmount} XRP`);
}

// ===== AUTOMATED MARKET MAKING (Admin-controlled via API) =====

// ===== AUTOMATED MARKET MAKING =====
if (MARKET_MAKING) {
  // Dynamic trading schedule based on admin settings
  let nextTradeTime = Date.now();

  // Check for trades every minute and execute based on frequency settings
  cron.schedule('* * * * *', async () => { // Check every minute
    try {
      // Check admin control status first
      const botStatus = await redis.get('volume_bot:status') || 'running';

      if (botStatus === 'paused' || botStatus === 'emergency_stopped') {
        logger.info(`🛑 Trading paused by admin: ${botStatus}`);
        return;
      }

      // Check if it's time to trade based on frequency setting
      if (Date.now() < nextTradeTime) {
        return; // Not time yet
      }

      // Get frequency setting from Redis (default to 30 minutes)
      const frequencySetting = await redis.get('volume_bot:frequency') || '30';

      let intervalMinutes;
      if (frequencySetting === 'random') {
        // Random interval between 5-45 minutes
        intervalMinutes = 5 + Math.random() * 40; // 5-45 minutes
        logger.info(`🎲 Random trading interval: ${intervalMinutes.toFixed(1)} minutes`);
      } else {
        intervalMinutes = parseInt(frequencySetting);
      }

      // Set next trade time
      nextTradeTime = Date.now() + (intervalMinutes * 60 * 1000);

      // Check if we're in emergency price recovery mode
      const currentPrice = await getCurrentWaldoPrice();
      const emergencyMode = currentPrice < 0.00005;

      // Execute trade with probability based on frequency and emergency mode
      let tradeProbability = Math.min(0.8, 30 / intervalMinutes); // Scale probability inversely with frequency

      if (emergencyMode) {
        tradeProbability = Math.min(0.95, tradeProbability * 3); // 3x higher probability during emergency
        logger.warn(`🚨 EMERGENCY MODE: Increased trade probability to ${(tradeProbability * 100).toFixed(1)}%`);
      }

      const shouldTrade = Math.random() < tradeProbability;

      if (shouldTrade) {
        logger.info(`⏰ Executing trade (Frequency: ${frequencySetting === 'random' ? 'Random' : frequencySetting + 'min'}, Next: ${new Date(nextTradeTime).toLocaleTimeString()})`);

        // Rarely do multiple trades in sequence (3% chance only)
        const multiTrade = Math.random() < 0.03;

        await createAutomatedTrade();

        if (multiTrade) {
          // Wait 2-5 minutes then do another trade
          const delay = (2 + Math.random() * 3) * 60 * 1000; // 2-5 minutes
          setTimeout(async () => {
            try {
              await createAutomatedTrade();
              logger.info('🎲 Multi-trade sequence executed');
            } catch (error) {
              logger.error('❌ Multi-trade error:', error);
            }
          }, delay);
        }
      } else {
        logger.info(`⏳ Next trade scheduled for: ${new Date(nextTradeTime).toLocaleTimeString()} (${frequencySetting === 'random' ? 'Random' : frequencySetting + 'min'} interval)`);
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

  // Check for profit tracking every hour
  if (PROFIT_TRACKING) {
    cron.schedule(`*/${PROFIT_CHECK_INTERVAL} * * * *`, async () => {
      try {
        await trackProfits();
      } catch (error) {
        logger.error('❌ Profit tracking error:', error);
      }
    });
  }

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
    const microAmount = Math.min(remaining, 500); // Process 500 WLO at a time

    logger.info(`🔄 Processing pending micro-sell: ${microAmount} WLO (${remaining} remaining)`);

    // Try to create a small passive sell offer
    const price = await getCurrentWaldoPrice();
    const discountedPrice = price * 0.98; // 2% below market
    const xrpTarget = parseFloat((microAmount * discountedPrice).toFixed(6));

    const offer = {
      TransactionType: 'OfferCreate',
      Account: tradingWallet.classicAddress,
      TakerGets: xrpl.xrpToDrops(xrpTarget.toString()),
      TakerPays: {
        currency: WALDO_CURRENCY,
        value: parseFloat(microAmount).toFixed(6),
        issuer: WALDO_ISSUER
      },
      Flags: 0x00000001 | 0x00010000, // tfSell | tfPassive
      Expiration: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minute expiration
    };

    const prepared = await client.autofill(offer);
    const signed = tradingWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const code = result.result?.meta?.TransactionResult;
    if (code === 'tesSUCCESS') {
      // Update remaining amount
      const newRemaining = remaining - microAmount;
      if (newRemaining > 0) {
        await redis.set('volume_bot:pending_sell_amount', newRemaining.toString());
        logger.info(`✅ Micro-sell offer created: ${microAmount} WLO, ${newRemaining} WLO remaining`);
      } else {
        await redis.del('volume_bot:pending_sell_amount');
        logger.info(`✅ Final micro-sell offer created: ${microAmount} WLO, all pending sells processed`);
      }

      // Record the trade
      await recordTrade('SELL', tradingWallet.classicAddress, xrpTarget, microAmount, discountedPrice);
    } else {
      logger.warn(`⚠️ Micro-sell offer failed: ${code}`);
    }
  } catch (error) {
    logger.error('❌ Micro-sell processing failed:', error);
  }
}

// ===== AUTOMATED TRADING FUNCTIONS =====
async function createAutomatedTrade() {
  try {
    // Double-check admin control status before executing trade
    const botStatus = await redis.get('volume_bot:status') || 'running';

    if (botStatus === 'paused' || botStatus === 'emergency_stopped') {
      logger.info(`🛑 Trade blocked by admin control: ${botStatus}`);
      return;
    }

    const currentPrice = await getCurrentWaldoPrice();

    // Get admin-controlled trading mode
    const tradingMode = await redis.get('trading_bot:trading_mode') || 'automated';
    const emergencyPriceThreshold = 0.00005; // Below 0.00005 XRP = emergency

    let tradeType;

    // NEW WEIGHTED PERPETUAL TRADING STRATEGY
    // Check current wallet balances to determine optimal trade direction
    const xrpBalance = await getXRPBalance(tradingWallet.classicAddress);
    const wloBalance = await getWLOBalance(tradingWallet.classicAddress);

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
      if (buyCount <= sellCount) {
        tradeType = 'BUY';
      } else {
        tradeType = 'SELL';
      }
      logger.info(`🎛️ ADMIN MODE: Buy & Sell (balanced) - executing ${tradeType} trade (last50 BUY=${buyCount}, SELL=${sellCount})`);
    } else if (tradingMode === 'automated' || tradingMode === 'perpetual') {
      // PERPETUAL WEIGHTED TRADING MODE

      // Emergency price protection - perpetual trading to recover price
      if (currentPrice < emergencyPriceThreshold) {
        // In emergency, use weighted probability to buy more often (70% buy, 30% sell)
        // This creates upward pressure while still generating volume
        tradeType = Math.random() < 0.70 ? 'BUY' : 'SELL';
        logger.warn(`🚨 EMERGENCY: Price ${currentPrice.toFixed(8)} below ${emergencyPriceThreshold} - ${tradeType} trade (70% buy bias for recovery)`);
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
    const adminMinSize = await redis.get('volume_bot:min_trade_size');
    const adminMaxSize = await redis.get('volume_bot:max_trade_size');

    // Use admin settings if available, otherwise use optimized defaults for low balance perpetual trading
    const baseMinTradeSize = adminMinSize ? parseFloat(adminMinSize) : 0.5; // Reduced for 10 XRP perpetual trading
    const baseMaxTradeSize = adminMaxSize ? parseFloat(adminMaxSize) : 1.5; // Reduced for sustainability

    // DYNAMIC TRADE SIZING FOR PERPETUAL TRADING
    // Adjust trade sizes based on available balances to ensure sustainability
    let minTradeSize = baseMinTradeSize;
    let maxTradeSize = baseMaxTradeSize;

    if (tradeType === 'BUY') {
      // For buys, limit based on available XRP (keep 20% reserve for fees and future trades)
      const maxBuyAmount = Math.max(0.5, (xrpBalance * 0.80) / 10); // Spread over 10 potential trades
      maxTradeSize = Math.min(baseMaxTradeSize, maxBuyAmount);
      minTradeSize = Math.min(baseMinTradeSize, maxTradeSize * 0.5);

      logger.info(`💰 BUY sizing: Available XRP=${xrpBalance.toFixed(2)}, Max buy=${maxBuyAmount.toFixed(2)}`);
    } else {
      // For sells, limit based on available WLO value (keep 20% reserve)
      const maxSellValueXrp = Math.max(0.5, (wloValueInXrp * 0.80) / 10); // Spread over 10 potential trades
      maxTradeSize = Math.min(baseMaxTradeSize, maxSellValueXrp);
      minTradeSize = Math.min(baseMinTradeSize, maxTradeSize * 0.5);

      logger.info(`💰 SELL sizing: Available WLO value=${wloValueInXrp.toFixed(2)} XRP, Max sell=${maxSellValueXrp.toFixed(2)}`);
    }

    logger.info(`🎛️ DYNAMIC SIZING: Base range ${baseMinTradeSize}-${baseMaxTradeSize} XRP, Adjusted to ${minTradeSize.toFixed(2)}-${maxTradeSize.toFixed(2)} XRP`);

    // Calculate trade amount using DYNAMIC SETTINGS
    let tradeAmount = parseFloat((minTradeSize + Math.random() * (maxTradeSize - minTradeSize)).toFixed(2));

    // Clamp to admin min/max to respect panel controls and avoid validation errors
    const effMin = baseMinTradeSize;
    const effMax = baseMaxTradeSize;
    if (tradeAmount < effMin) tradeAmount = effMin;
    if (tradeAmount > effMax) tradeAmount = effMax;

    logger.info(`💰 Final trade amount: ${tradeAmount} XRP (after clamping to admin ${effMin}-${effMax})`);

    // SAFETY CHECKS FOR PERPETUAL TRADING
    // Ensure we have minimum balances to continue trading
    const minXrpReserve = 2.0; // Keep at least 2 XRP for fees and future trades (optimized for low balance)
    const minWloReserve = 500; // Keep at least 500 WLO for future trades (reduced for efficiency)

    // In emergency mode, relax the reserve requirements to allow aggressive perpetual trading
    const isEmergency = currentPrice < emergencyPriceThreshold;
    const requiredXrpReserve = isEmergency ? 0.3 : minXrpReserve; // In emergency, only keep 0.3 XRP reserve
    const requiredWloReserve = isEmergency ? 100 : minWloReserve; // In emergency, only keep 100 WLO reserve

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
      const xrpBalance = await getXRPBalance(tradingWallet.classicAddress);
      if (xrpBalance < tradeAmount + 1) { // +1 XRP for transaction fees
        logger.warn(`⚠️ Insufficient XRP balance: ${xrpBalance} XRP, need ${tradeAmount + 1} XRP`);
        return;
      }

      // Execute REAL BUY trade on XRPL
      try {
        logger.info(`🔄 Executing REAL BUY trade: ${tradeAmount} XRP for ${waldoAmount.toFixed(0)} WLO`);
        const result = await buyWaldo(tradingWallet.classicAddress, tradeAmount);
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
      const wloBalance = await getWLOBalance(tradingWallet.classicAddress);
      if (wloBalance < waldoAmount) {
        logger.warn(`⚠️ Insufficient WLO balance: ${wloBalance} WLO, need ${waldoAmount} WLO`);
        return;
      }

      // Execute REAL SELL trade on XRPL
      try {
        logger.info(`🔄 Executing REAL SELL trade: ${waldoAmount} WLO for ${xrpAmount.toFixed(4)} XRP`);
        const result = await sellWaldo(tradingWallet.classicAddress, waldoAmount);
        if (result.success) {
          logger.info(`✅ REAL SELL executed: ${result.hash}`);
          message += `\n🔗 TX: ${result.hash}`;
        } else {
          logger.error(`❌ REAL SELL failed: ${result.error}`);
          return; // Skip posting if trade failed
        }
      } catch (error) {
        logger.error(`❌ REAL SELL error: ${error.message}`);
        return; // Skip posting if trade failed
      }
    }

    logger.info(`🤖 Automated ${tradeType} trade created: ${tradeAmount} XRP`);

  } catch (error) {
    logger.error('❌ Automated trade creation failed:', error);
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

    // Get wallet balance from XRPL
    if (!tradingWallet || !client.isConnected()) {
      await redis.set('volume_bot:wallet_balance', 'Wallet not connected');
      return;
    }

    const accountInfo = await client.request({
      command: 'account_info',
      account: tradingWallet.classicAddress
    });

    const xrpBalance = parseFloat(accountInfo.result.account_data.Balance) / 1000000;

    // Get WLO balance
    const accountLines = await client.request({
      command: 'account_lines',
      account: tradingWallet.classicAddress
    });

    let waldoBalance = 0;
    if (accountLines.result.lines) {
      const waldoLine = accountLines.result.lines.find(line =>
        line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
      );
      if (waldoLine) {
        waldoBalance = parseFloat(waldoLine.balance);
      }
    }

    // Store individual balances for admin panel
    await redis.set('volume_bot:xrp_balance', xrpBalance.toFixed(4));
    await redis.set('volume_bot:wlo_balance', waldoBalance.toFixed(0));

    const balanceString = `${xrpBalance.toFixed(2)} XRP + ${waldoBalance.toFixed(0)} WLO`;
    await redis.set('volume_bot:wallet_balance', balanceString);

    logger.info(`💰 Wallet balance updated: ${balanceString}`);
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
  if (!PROFIT_TRACKING) {
    return;
  }

  try {
    // Get current trading wallet balance
    let currentBalance = 0;
    if (tradingWallet && client.isConnected()) {
      const accountInfo = await client.request({
        command: 'account_info',
        account: tradingWallet.classicAddress,
        ledger_index: 'validated'
      });
      currentBalance = parseFloat(xrpl.dropsToXrp(accountInfo.result.account_data.Balance));
    } else {
      // In stealth mode, simulate balance tracking
      const storedBalance = await redis.get('waldo:simulated_balance') || STARTING_BALANCE.toString();
      currentBalance = parseFloat(storedBalance);
    }

    // Calculate profits
    const totalProfit = currentBalance - STARTING_BALANCE;

    // Store profit data
    await redis.set('waldo:current_balance', currentBalance.toString());
    await redis.set('waldo:total_profit', totalProfit.toString());

    // Check if we should reserve some profits
    if (currentBalance > PROFIT_RESERVE_THRESHOLD) {
      const excessAmount = currentBalance - STARTING_BALANCE;
      const reserveAmount = (excessAmount * PROFIT_RESERVE_PERCENTAGE) / 100;

      // Record profit reserve (conceptual - money stays in wallet)
      await recordProfitReserve(reserveAmount);
    }

    // Log current status
    logger.info(`💰 Trading wallet balance: ${currentBalance.toFixed(4)} XRP (Profit: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(4)} XRP)`);

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
