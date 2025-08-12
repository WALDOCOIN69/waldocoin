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

// ===== TRADING PARAMETERS =====
const MIN_TRADE_XRP = parseFloat(process.env.MIN_TRADE_AMOUNT_XRP) || 1;
const MAX_TRADE_XRP = parseFloat(process.env.MAX_TRADE_AMOUNT_XRP) || 100;
const PRICE_SPREAD = parseFloat(process.env.PRICE_SPREAD_PERCENTAGE) || 2.5;
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

// ===== XRPL CONNECTION =====
async function connectXRPL() {
  try {
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
    // Get recent trades from XRPL to calculate current price
    const response = await client.request({
      command: 'account_tx',
      account: WALDO_ISSUER,
      limit: 10,
      ledger_index_min: -1,
      ledger_index_max: -1
    });

    // Calculate average price from recent trades
    let totalXRP = 0;
    let totalWLO = 0;
    let tradeCount = 0;

    for (const tx of response.result.transactions) {
      if (tx.tx.TransactionType === 'Payment' && tx.tx.Amount && typeof tx.tx.Amount === 'object') {
        if (tx.tx.Amount.currency === WALDO_CURRENCY) {
          totalWLO += parseFloat(tx.tx.Amount.value);
          totalXRP += parseFloat(xrpl.dropsToXrp(tx.tx.SendMax || '0'));
          tradeCount++;
        }
      }
    }

    if (tradeCount > 0) {
      currentPrice = totalXRP / totalWLO;
    } else {
      currentPrice = 0.00001; // Default price if no trades found
    }

    await redis.set('waldo:current_price', currentPrice.toString());
    return currentPrice;
  } catch (error) {
    logger.error('❌ Error getting WALDO price:', error);
    return currentPrice || 0.00001;
  }
}

// ===== TRADING FUNCTIONS =====
async function buyWaldo(userAddress, xrpAmount) {
  try {
    if (xrpAmount < MIN_TRADE_XRP || xrpAmount > MAX_TRADE_XRP) {
      throw new Error(`Trade amount must be between ${MIN_TRADE_XRP} and ${MAX_TRADE_XRP} XRP`);
    }

    const price = await getCurrentWaldoPrice();
    const waldoAmount = (xrpAmount / price) * (1 - PRICE_SPREAD / 100); // Apply spread

    // Create payment transaction
    const payment = {
      TransactionType: 'Payment',
      Account: tradingWallet.classicAddress,
      Destination: userAddress,
      Amount: {
        currency: WALDO_CURRENCY,
        value: waldoAmount.toString(),
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
    const xrpAmount = (waldoAmount * price) * (1 - PRICE_SPREAD / 100); // Apply spread

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
        value: waldoAmount.toString(),
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
  const welcomeMessage = `🤖 **WALDOCOIN Trading Bot**\n\n` +
    `Trade WLO tokens directly through Telegram!\n\n` +
    `**Commands:**\n` +
    `💰 /buy [amount] - Buy WLO with XRP\n` +
    `💸 /sell [amount] - Sell WLO for XRP\n` +
    `📊 /price - Current WLO price\n` +
    `📈 /stats - Trading statistics\n` +
    `💼 /balance - Your wallet balance\n` +
    `❓ /help - Show this help\n\n` +
    `**Example:** \`/buy 10\` (buy WLO with 10 XRP)\n\n` +
    `⚠️ **Connect your wallet first with** /wallet\n\n` +
    `💰 **Min Trade**: ${MIN_TRADE_XRP} XRP | **Max Trade**: ${MAX_TRADE_XRP} XRP`;

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

bot.onText(/\/buy (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const xrpAmount = parseFloat(match[1]);

  if (isNaN(xrpAmount)) {
    bot.sendMessage(chatId, '❌ Invalid amount. Use: /buy [XRP amount]');
    return;
  }

  // Get user wallet (you'll need to implement wallet connection)
  const userWallet = await getUserWallet(msg.from.id);
  if (!userWallet) {
    bot.sendMessage(chatId, '❌ Please connect your wallet first with /wallet');
    return;
  }

  bot.sendMessage(chatId, '⏳ Processing your buy order...');

  const result = await buyWaldo(userWallet, xrpAmount);

  if (result.success) {
    const message = `✅ **Buy Order Successful!**\n\n` +
      `💰 **Purchased**: ${result.waldoAmount.toFixed(0)} WLO\n` +
      `💸 **Cost**: ${xrpAmount} XRP\n` +
      `📊 **Price**: ${result.price.toFixed(8)} XRP per WLO\n` +
      `🔗 **Hash**: \`${result.hash}\``;

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, `❌ Buy order failed: ${result.error}`);
  }
});

// ===== AUTOMATED MARKET MAKING =====
if (MARKET_MAKING) {
  // Create trading activity every 2-5 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await createAutomatedTrade();
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
}

// ===== AUTOMATED TRADING FUNCTIONS =====
async function createAutomatedTrade() {
  try {
    const price = await getCurrentWaldoPrice();
    const volume = dailyVolume;

    // Generate random trade parameters
    const tradeTypes = ['BUY', 'SELL'];
    const tradeType = tradeTypes[Math.floor(Math.random() * tradeTypes.length)];

    // Random amounts based on current activity
    const baseAmount = volume < 50 ? 5 : Math.min(volume / 10, 20);
    const randomMultiplier = 0.5 + Math.random(); // 0.5 to 1.5
    const tradeAmount = Math.max(1, Math.floor(baseAmount * randomMultiplier));

    let message = '';

    if (tradeType === 'BUY') {
      const waldoAmount = (tradeAmount / price) * (1 - PRICE_SPREAD / 100);

      if (STEALTH_MODE) {
        // Natural looking personal message
        const naturalMessages = [
          `Just picked up ${waldoAmount.toFixed(0)} more WALDO for ${tradeAmount} XRP 💰`,
          `Added ${waldoAmount.toFixed(0)} WLO to my bag at ${price.toFixed(8)} XRP 🎯`,
          `Bought the dip - ${tradeAmount} XRP worth of WALDO 📈`,
          `Loading up on WALDO - ${waldoAmount.toFixed(0)} WLO secured 🚀`,
          `Another ${tradeAmount} XRP into WALDO, feeling bullish 💪`
        ];
        message = naturalMessages[Math.floor(Math.random() * naturalMessages.length)];
      } else {
        message = `🟢 **Buy Order**\n\n` +
          `💰 **Purchased**: ${waldoAmount.toFixed(0)} WLO\n` +
          `💸 **Cost**: ${tradeAmount} XRP\n` +
          `📊 **Price**: ${price.toFixed(8)} XRP per WLO`;
      }

      // Record the simulated trade
      await recordTrade('BUY', 'personal', tradeAmount, waldoAmount, price);

    } else {
      const waldoAmount = Math.floor(50000 + Math.random() * 100000);
      const xrpAmount = (waldoAmount * price) * (1 - PRICE_SPREAD / 100);

      if (STEALTH_MODE) {
        // Natural looking personal message
        const naturalMessages = [
          `Took some profits - sold ${waldoAmount.toFixed(0)} WALDO for ${xrpAmount.toFixed(2)} XRP 💸`,
          `Trimmed my WALDO position, ${xrpAmount.toFixed(2)} XRP secured 📊`,
          `Sold ${waldoAmount.toFixed(0)} WLO at good price ${price.toFixed(8)} XRP 🎯`,
          `Taking profits on WALDO - ${xrpAmount.toFixed(2)} XRP out 💰`,
          `Reduced WALDO holdings by ${waldoAmount.toFixed(0)} tokens 📉`
        ];
        message = naturalMessages[Math.floor(Math.random() * naturalMessages.length)];
      } else {
        message = `🔴 **Sell Order**\n\n` +
          `💸 **Sold**: ${waldoAmount.toFixed(0)} WLO\n` +
          `💰 **Received**: ${xrpAmount.toFixed(4)} XRP\n` +
          `📊 **Price**: ${price.toFixed(8)} XRP per WLO`;
      }

      // Record the simulated trade
      await recordTrade('SELL', 'personal', xrpAmount, waldoAmount, price);
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

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `🤖 **WALDOCOIN Trading Bot Help**\n\n` +
    `**Setup:**\n` +
    `🔗 /wallet [address] - Connect your XRPL wallet\n\n` +
    `**Trading:**\n` +
    `💰 /buy [XRP amount] - Buy WLO tokens\n` +
    `💸 /sell [WLO amount] - Sell WLO tokens\n\n` +
    `**Information:**\n` +
    `📊 /price - Current WLO price\n` +
    `📈 /stats - Trading statistics\n` +
    `💼 /balance - Your wallet balance\n\n` +
    `**Examples:**\n` +
    `\`/wallet rYourWalletAddress123...\`\n` +
    `\`/buy 10\` (buy WLO with 10 XRP)\n` +
    `\`/sell 50000\` (sell 50,000 WLO)\n\n` +
    `⚠️ **Trading Limits:**\n` +
    `Min: ${MIN_TRADE_XRP} XRP | Max: ${MAX_TRADE_XRP} XRP\n` +
    `Spread: ${PRICE_SPREAD}%`;

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
