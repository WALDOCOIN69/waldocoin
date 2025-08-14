// 🤖 WALDOCOIN TRADING BOT - Buy/Sell WLO Tokens

import TelegramBot from 'node-telegram-bot-api';
import xrpl from 'xrpl';
import { createClient } from 'redis';
import cron from 'node-cron';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

// ===== CONFIGURATION =====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const XRPL_NODE = process.env.XRPL_NODE || 'wss://xrplcluster.com';
const TRADING_WALLET_SECRET = process.env.TRADING_WALLET_SECRET;
const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WALDO_CURRENCY = process.env.WALDO_CURRENCY || 'WLO';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const PERSONAL_MODE = process.env.PERSONAL_ACCOUNT_MODE === 'true';
const STEALTH_MODE = process.env.STEALTH_MODE === 'true';

// ===== PROFIT MANAGEMENT CONFIGURATION =====
const PROFIT_TRACKING = process.env.PROFIT_TRACKING_ENABLED === 'true';
const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE_XRP) || 70;
const PROFIT_RESERVE_THRESHOLD = parseFloat(process.env.PROFIT_RESERVE_THRESHOLD) || 200;
const PROFIT_RESERVE_PERCENTAGE = parseFloat(process.env.PROFIT_RESERVE_PERCENTAGE) || 50;
const PROFIT_CHECK_INTERVAL = parseInt(process.env.PROFIT_CHECK_INTERVAL) || 60;

// ===== TRADING PARAMETERS =====
const MIN_TRADE_XRP = parseFloat(process.env.MIN_TRADE_AMOUNT_XRP) || 1;
const MAX_TRADE_XRP = parseFloat(process.env.MAX_TRADE_AMOUNT_XRP) || 100;
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
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new xrpl.Client(XRPL_NODE);
const redis = createClient({ url: process.env.REDIS_URL });

let tradingWallet = null;
let currentPrice = 0;
let dailyVolume = 0;

// ===== REDIS CONNECTION =====
redis.on('error', (err) => logger.error('Redis error:', err));
redis.on('connect', () => logger.info('Connected to Redis'));
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
    await redis.set('volume_bot:trading_mode', 'automated'); // Default to automated mode
    logger.info('🎛️ Initialized default trading mode: Automated');
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

    await client.connect();
    tradingWallet = xrpl.Wallet.fromSeed(TRADING_WALLET_SECRET);
    logger.info(`🔗 Connected to XRPL - Trading wallet: ${tradingWallet.classicAddress}`);
    return true;
  } catch (error) {
    logger.error('❌ XRPL connection failed:', error);
    return false;
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

    const response = await client.request(orderBookRequest);

    if (response.result && response.result.offers && response.result.offers.length > 0) {
      // Get the best offer (lowest ask price)
      const bestOffer = response.result.offers[0];
      const takerGets = parseFloat(bestOffer.TakerGets) / 1000000; // Convert drops to XRP
      const takerPays = parseFloat(bestOffer.TakerPays.value);

      // Calculate price: XRP per WLO
      const realPrice = takerGets / takerPays;

      if (realPrice > 0 && isFinite(realPrice)) {
        currentPrice = realPrice;
        await redis.set('waldo:current_price', currentPrice.toString());
        logger.info(`📊 Real-time price from XRPL DEX: ${currentPrice.toFixed(8)} XRP per WLO`);
        return currentPrice;
      }
    }

    // Fallback: Try reverse order book (WLO -> XRP)
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

    if (reverseResponse.result && reverseResponse.result.offers && reverseResponse.result.offers.length > 0) {
      const bestOffer = reverseResponse.result.offers[0];
      const takerGets = parseFloat(bestOffer.TakerGets.value);
      const takerPays = parseFloat(bestOffer.TakerPays) / 1000000; // Convert drops to XRP

      // Calculate price: XRP per WLO
      const realPrice = takerPays / takerGets;

      if (realPrice > 0 && isFinite(realPrice)) {
        currentPrice = realPrice;
        await redis.set('waldo:current_price', currentPrice.toString());
        logger.info(`📊 Real-time price from XRPL DEX (reverse): ${currentPrice.toFixed(8)} XRP per WLO`);
        return currentPrice;
      }
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
    if (xrpAmount < MIN_TRADE_XRP || xrpAmount > MAX_TRADE_XRP) {
      throw new Error(`Trade amount must be between ${MIN_TRADE_XRP} and ${MAX_TRADE_XRP} XRP`);
    }

    const price = await getCurrentWaldoPrice();

    // Safety check: prevent zero or invalid price
    if (price <= 0 || isNaN(price) || !isFinite(price)) {
      throw new Error('Invalid price calculation - cannot execute trade');
    }

    const waldoAmount = parseFloat(((xrpAmount / price) * (1 - PRICE_SPREAD / 100)).toFixed(6)); // Apply spread and round to 6 decimals

    // Safety check: prevent infinite or zero amounts
    if (!isFinite(waldoAmount) || waldoAmount <= 0) {
      throw new Error('Invalid trade amount calculation');
    }

    // Create payment transaction
    const payment = {
      TransactionType: 'Payment',
      Account: tradingWallet.classicAddress,
      Destination: userAddress,
      Amount: {
        currency: WALDO_CURRENCY,
        value: parseFloat(waldoAmount).toFixed(6),
        issuer: WALDO_ISSUER
      },
      SendMax: xrpl.xrpToDrops(xrpAmount.toString())
    };

    const prepared = await client.autofill(payment);
    const signed = tradingWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      // Record trade
      await recordTrade('BUY', userAddress, xrpAmount, waldoAmount, price);
      return {
        success: true,
        hash: result.result.hash,
        waldoAmount: waldoAmount,
        price: price
      };
    } else {
      throw new Error(`Transaction failed: ${result.result.meta.TransactionResult}`);
    }
  } catch (error) {
    logger.error('❌ Buy WALDO failed:', error);
    return { success: false, error: error.message };
  }
}

async function sellWaldo(userAddress, waldoAmount) {
  try {
    const price = await getCurrentWaldoPrice();

    // Safety check: prevent zero or invalid price
    if (price <= 0 || isNaN(price) || !isFinite(price)) {
      throw new Error('Invalid price calculation - cannot execute trade');
    }

    const xrpAmount = parseFloat(((waldoAmount * price) * (1 - PRICE_SPREAD / 100)).toFixed(6)); // Apply spread and round to 6 decimals

    // Safety check: prevent zero amounts
    if (!isFinite(xrpAmount) || xrpAmount <= 0) {
      throw new Error('Invalid trade amount calculation');
    }

    if (xrpAmount < MIN_TRADE_XRP) {
      throw new Error(`Minimum trade value is ${MIN_TRADE_XRP} XRP`);
    }

    // Create payment transaction
    const payment = {
      TransactionType: 'Payment',
      Account: tradingWallet.classicAddress,
      Destination: userAddress,
      Amount: xrpl.xrpToDrops(xrpAmount.toString()),
      SendMax: {
        currency: WALDO_CURRENCY,
        value: parseFloat(waldoAmount).toFixed(6),
        issuer: WALDO_ISSUER
      }
    };

    const prepared = await client.autofill(payment);
    const signed = tradingWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      // Record trade
      await recordTrade('SELL', userAddress, xrpAmount, waldoAmount, price);
      return {
        success: true,
        hash: result.result.hash,
        xrpAmount: xrpAmount,
        price: price
      };
    } else {
      throw new Error(`Transaction failed: ${result.result.meta.TransactionResult}`);
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
  await redis.lpush('volume_bot:recent_trades', JSON.stringify({
    type: type,
    amount: waldoAmount.toFixed(0),
    currency: 'WLO',
    price: xrpAmount.toFixed(4),
    timestamp: new Date().toISOString(),
    hash: trade.hash || null
  }));

  // Keep only last 50 trades for admin panel
  await redis.ltrim('volume_bot:recent_trades', 0, 49);

  // Update daily counters for admin panel
  const today = new Date().toISOString().split('T')[0];
  await redis.incr(`volume_bot:trades_${today}`);
  await redis.set('volume_bot:trades_today', await redis.get(`volume_bot:trades_${today}`) || '0');
  await redis.set('volume_bot:volume_24h', dailyVolume.toString());

  // Update last trade timestamp for admin panel
  await redis.set('volume_bot:last_trade', new Date().toISOString());

  // Announce trade if enabled
  if (process.env.ANNOUNCE_TRADES === 'true' && CHANNEL_ID) {
    const message = `🔄 **WALDO Trade Alert**\n\n` +
      `**${type}**: ${waldoAmount.toFixed(0)} WLO\n` +
      `**Price**: ${price.toFixed(8)} XRP per WLO\n` +
      `**Volume**: ${xrpAmount.toFixed(2)} XRP\n` +
      `**Hash**: \`${trade.hash || 'Processing...'}\`\n\n` +
      `💹 Daily Volume: ${dailyVolume.toFixed(2)} XRP`;

    try {
      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('❌ Failed to announce trade:', error);
    }
  }

  logger.info(`📊 Trade recorded: ${type} ${waldoAmount} WLO for ${xrpAmount} XRP`);
}

// ===== BOT COMMANDS =====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  // Only respond to admin
  if (chatId.toString() !== ADMIN_ID) {
    bot.sendMessage(chatId, '🤖 WALDO Volume Bot is running! Check @waldocoin for trading activity.');
    return;
  }

  const welcomeMessage = `🤖 **WALDO Volume Bot - Admin Panel**\n\n` +
    `**Volume Bot Status**: ✅ Active\n` +
    `**Trading Wallet**: ${TRADING_WALLET_ADDRESS || 'Not configured'}\n\n` +
    `**Available Commands:**\n` +
    `📊 /price - Current WLO price\n` +
    `📈 /stats - Trading statistics\n` +
    `⚙️ /status - Bot status\n` +
    `🛑 /emergency - Emergency stop\n\n` +
    `**Volume Generation**: Every 60 minutes\n` +
    `**Daily Target**: ${process.env.MAX_DAILY_VOLUME_XRP || 150} XRP`;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const price = await getCurrentWaldoPrice();
    const volume = await redis.get('waldo:daily_volume') || '0';

    const message = `📊 **WALDO Price Info**\n\n` +
      `💰 **Current Price**: ${price.toFixed(8)} XRP per WLO\n` +
      `📈 **24h Volume**: ${parseFloat(volume).toFixed(2)} XRP\n` +
      `🎯 **Spread**: ${PRICE_SPREAD}%\n\n` +
      `**Buy Price**: ${(price * (1 + PRICE_SPREAD / 100)).toFixed(8)} XRP\n` +
      `**Sell Price**: ${(price * (1 - PRICE_SPREAD / 100)).toFixed(8)} XRP`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching price data');
  }
});

// Remove user trading commands - this is a volume bot only
bot.onText(/\/buy|\/sell|\/wallet|\/balance/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🤖 This is a volume generation bot. Check @waldocoin for trading activity updates!');
});

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
    const volume = dailyVolume;

    // Get admin-controlled trading mode
    const tradingMode = await redis.get('volume_bot:trading_mode') || 'automated';
    const emergencyPriceThreshold = 0.00005; // Below 0.00005 XRP = emergency

    let tradeType;

    // Determine trade type based on admin mode and price conditions
    if (tradingMode === 'buy_only') {
      tradeType = 'BUY';
      logger.info(`🎛️ ADMIN MODE: Buy Only - executing BUY trade`);
    } else if (tradingMode === 'sell_only') {
      tradeType = 'SELL';
      logger.info(`🎛️ ADMIN MODE: Sell Only - executing SELL trade`);
    } else if (tradingMode === 'buy_sell') {
      // Manual buy & sell mode - random selection
      const tradeTypes = ['BUY', 'SELL'];
      tradeType = tradeTypes[Math.floor(Math.random() * tradeTypes.length)];
      logger.info(`🎛️ ADMIN MODE: Buy & Sell - executing ${tradeType} trade`);
    } else if (tradingMode === 'automated') {
      // Automated mode with emergency detection
      if (currentPrice < emergencyPriceThreshold) {
        tradeType = 'BUY'; // ONLY BUY when price is critically low
        logger.warn(`🚨 AUTOMATED EMERGENCY: Price ${currentPrice.toFixed(8)} below ${emergencyPriceThreshold} - BUY ONLY MODE`);
      } else {
        // Normal trading when price is healthy
        const tradeTypes = ['BUY', 'SELL'];
        tradeType = tradeTypes[Math.floor(Math.random() * tradeTypes.length)];
        logger.info(`🤖 AUTOMATED MODE: Normal trading - executing ${tradeType} trade`);
      }
    }

    // Dynamic trade amounts based on price emergency
    let tradePatterns;
    if (currentPrice < emergencyPriceThreshold) {
      // EMERGENCY MODE: Larger, more aggressive buys to push price up
      tradePatterns = [
        { min: 2.0, max: 4.0, weight: 50 },  // Aggressive buys (50% chance)
        { min: 4.0, max: 6.0, weight: 30 },  // Large buys (30% chance)
        { min: 6.0, max: 10.0, weight: 20 }  // Massive buys (20% chance)
      ];
      logger.warn(`🚨 EMERGENCY TRADE AMOUNTS: Using aggressive buy sizes to recover price`);
    } else {
      // Normal conservative amounts
      tradePatterns = [
        { min: 0.5, max: 1.0, weight: 70 },  // Tiny trades (70% chance)
        { min: 1.0, max: 1.5, weight: 25 },  // Small trades (25% chance)
        { min: 1.5, max: 2.0, weight: 5 }    // Medium trades (5% chance only)
      ];
    }

    // Weighted random selection
    const random = Math.random() * 100;
    let cumulative = 0;
    let selectedPattern = tradePatterns[0];

    for (const pattern of tradePatterns) {
      cumulative += pattern.weight;
      if (random <= cumulative) {
        selectedPattern = pattern;
        break;
      }
    }

    // Calculate final trade amount with micro-randomization
    const baseAmount = selectedPattern.min + Math.random() * (selectedPattern.max - selectedPattern.min);
    const microVariation = 0.95 + Math.random() * 0.1; // ±5% micro-variation
    const tradeAmount = parseFloat((baseAmount * microVariation).toFixed(2));

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

      const waldoAmount = Math.floor(2000 + Math.random() * 3000); // 2K-5K WLO (much smaller for limited liquidity)
      const xrpAmount = parseFloat(((waldoAmount * currentPrice) * (1 - PRICE_SPREAD / 100)).toFixed(6)); // Round to 6 decimals for XRPL

      // Safety check: prevent zero amounts
      if (!isFinite(xrpAmount) || xrpAmount <= 0) {
        logger.error('❌ Invalid XRP amount calculation, skipping trade');
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

    // Send as personal message to channel (looks like you posted it)
    if (CHANNEL_ID && PERSONAL_MODE) {
      // In personal mode, you would manually post these messages
      // Or use a different method to post as yourself
      logger.info(`📝 Personal message ready: ${message}`);
    } else if (CHANNEL_ID) {
      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
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

    if (CHANNEL_ID && !PERSONAL_MODE) {
      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
    } else if (PERSONAL_MODE) {
      logger.info(`📝 Personal update ready: ${message}`);
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

    if (CHANNEL_ID) {
      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }

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
    if (CHANNEL_ID && !PERSONAL_MODE) {
      const message = `🌅 **New Trading Day Started**\n\n` +
        `📊 **Yesterday**: ${parseFloat(currentVolume).toFixed(2)} XRP volume, ${currentTrades} trades\n` +
        `🎯 **Today**: Fresh start - let's build volume!\n\n` +
        `🤖 **Market Making**: Active 24/7`;

      await bot.sendMessage(CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }

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
async function getUserWallet(userId) {
  try {
    const wallet = await redis.get(`user:${userId}:wallet`);
    return wallet;
  } catch (error) {
    logger.error('❌ Error getting user wallet:', error);
    return null;
  }
}

async function setUserWallet(userId, walletAddress) {
  try {
    await redis.set(`user:${userId}:wallet`, walletAddress);
    return true;
  } catch (error) {
    logger.error('❌ Error setting user wallet:', error);
    return false;
  }
}

// ===== ADDITIONAL BOT COMMANDS =====
bot.onText(/\/wallet (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const walletAddress = match[1].trim();

  // Validate XRPL address
  if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(walletAddress)) {
    bot.sendMessage(chatId, '❌ Invalid XRPL wallet address format');
    return;
  }

  const success = await setUserWallet(userId, walletAddress);
  if (success) {
    bot.sendMessage(chatId, `✅ Wallet connected: \`${walletAddress}\`\n\nYou can now use /buy and /sell commands!`,
      { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, '❌ Failed to connect wallet. Please try again.');
  }
});

bot.onText(/\/sell (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const waldoAmount = parseFloat(match[1]);

  if (isNaN(waldoAmount)) {
    bot.sendMessage(chatId, '❌ Invalid amount. Use: /sell [WLO amount]');
    return;
  }

  const userWallet = await getUserWallet(msg.from.id);
  if (!userWallet) {
    bot.sendMessage(chatId, '❌ Please connect your wallet first with /wallet [address]');
    return;
  }

  bot.sendMessage(chatId, '⏳ Processing your sell order...');

  const result = await sellWaldo(userWallet, waldoAmount);

  if (result.success) {
    const message = `✅ **Sell Order Successful!**\n\n` +
      `💸 **Sold**: ${waldoAmount.toFixed(0)} WLO\n` +
      `💰 **Received**: ${result.xrpAmount.toFixed(4)} XRP\n` +
      `📊 **Price**: ${result.price.toFixed(8)} XRP per WLO\n` +
      `🔗 **Hash**: \`${result.hash}\``;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, `❌ Sell order failed: ${result.error}`);
  }
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const volume = await redis.get('waldo:daily_volume') || '0';
    const tradesCount = await redis.lLen('waldo:trades');
    const price = currentPrice;

    const message = `📈 **WALDO Trading Statistics**\n\n` +
      `💰 **Current Price**: ${price.toFixed(8)} XRP per WLO\n` +
      `📊 **24h Volume**: ${parseFloat(volume).toFixed(2)} XRP\n` +
      `🔄 **Total Trades**: ${tradesCount}\n` +
      `🎯 **Spread**: ${PRICE_SPREAD}%\n` +
      `⚡ **Min Trade**: ${MIN_TRADE_XRP} XRP\n` +
      `🚀 **Max Trade**: ${MAX_TRADE_XRP} XRP\n\n` +
      `🤖 **Market Making**: ${MARKET_MAKING ? 'Active' : 'Inactive'}`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching statistics');
  }
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const userWallet = await getUserWallet(msg.from.id);

  if (!userWallet) {
    bot.sendMessage(chatId, '❌ Please connect your wallet first with /wallet [address]');
    return;
  }

  try {
    // Get XRP balance
    const accountInfo = await client.request({
      command: 'account_info',
      account: userWallet,
      ledger_index: 'validated'
    });
    const xrpBalance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);

    // Get WALDO balance
    let waldoBalance = 0;
    try {
      const accountLines = await client.request({
        command: 'account_lines',
        account: userWallet,
        ledger_index: 'validated'
      });

      const waldoLine = accountLines.result.lines.find(line =>
        line.currency === WALDO_CURRENCY && line.account === WALDO_ISSUER
      );

      if (waldoLine) {
        waldoBalance = parseFloat(waldoLine.balance);
      }
    } catch (error) {
      logger.warn('Could not fetch WALDO balance:', error.message);
    }

    const message = `💼 **Your Wallet Balance**\n\n` +
      `**Address**: \`${userWallet}\`\n\n` +
      `💰 **XRP**: ${parseFloat(xrpBalance).toFixed(4)} XRP\n` +
      `🎯 **WALDO**: ${waldoBalance.toFixed(0)} WLO\n\n` +
      `💵 **WALDO Value**: ${(waldoBalance * currentPrice).toFixed(4)} XRP`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching balance. Make sure your wallet address is correct.');
  }
});

bot.onText(/\/profits/, async (msg) => {
  const chatId = msg.chat.id;

  // Only respond to admin
  if (chatId.toString() !== ADMIN_ID) {
    return;
  }

  try {
    // Get profit tracking data
    const currentBalance = await redis.get('waldo:current_balance') || STARTING_BALANCE.toString();
    const totalProfit = await redis.get('waldo:total_profit') || '0';
    const totalReserved = await redis.get('waldo:total_reserved') || '0';

    // Get profit reserves history
    const profitReserves = await redis.lRange('waldo:profit_reserves', 0, -1);
    const reserves = profitReserves.map(reserve => JSON.parse(reserve));
    const recentReserves = reserves.slice(-5); // Last 5 reserves

    const profitNum = parseFloat(totalProfit);
    const balanceNum = parseFloat(currentBalance);
    const reservedNum = parseFloat(totalReserved);

    const message = `💰 **Volume Bot Profit Report**\n\n` +
      `💼 **Current Balance**: ${balanceNum.toFixed(4)} XRP\n` +
      `🚀 **Starting Balance**: ${STARTING_BALANCE.toFixed(4)} XRP\n` +
      `📈 **Total Profit**: ${profitNum >= 0 ? '+' : ''}${profitNum.toFixed(4)} XRP\n` +
      `💎 **Reserved Profits**: ${reservedNum.toFixed(4)} XRP\n` +
      `🎯 **Reserve Threshold**: ${PROFIT_RESERVE_THRESHOLD} XRP\n` +
      `📊 **Reserve Percentage**: ${PROFIT_RESERVE_PERCENTAGE}%\n\n` +
      `**Recent Reserves:**\n` +
      (recentReserves.length > 0 ?
        recentReserves.map(reserve =>
          `• ${reserve.amount.toFixed(4)} XRP - ${new Date(reserve.timestamp).toLocaleDateString()}`
        ).join('\n') : '• No reserves yet') +
      `\n\n🤖 **Profit Tracking**: ${PROFIT_TRACKING ? 'Enabled' : 'Disabled'}\n` +
      `💡 **Note**: All profits stay in trading wallet`;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Error fetching profit data');
  }
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  // Only respond to admin
  if (chatId.toString() !== ADMIN_ID) {
    bot.sendMessage(chatId, '🤖 WALDO Volume Bot is running! Check @waldocoin for trading activity.');
    return;
  }

  const helpMessage = `🤖 **WALDO Volume Bot - Admin Commands**\n\n` +
    `**Information:**\n` +
    `📊 /price - Current WLO price\n` +
    `📈 /stats - Trading statistics\n` +
    `💰 /profits - Profit skimming report\n` +
    `⚙️ /status - Bot status\n\n` +
    `**Settings:**\n` +
    `🚀 **Starting Balance**: ${STARTING_BALANCE} XRP\n` +
    `🎯 **Reserve Threshold**: ${PROFIT_RESERVE_THRESHOLD} XRP\n` +
    `📈 **Reserve Percentage**: ${PROFIT_RESERVE_PERCENTAGE}%\n` +
    `🤖 **Profit Tracking**: ${PROFIT_TRACKING ? 'Enabled' : 'Disabled'}`;

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// ===== STARTUP =====
async function startBot() {
  logger.info('🚀 Starting WALDO Trading Bot...');

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
  await redis.disconnect();
  process.exit(0);
});

// ===== START THE BOT =====
startBot().catch(console.error);
