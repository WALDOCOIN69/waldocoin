import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const userSessions = new Map();

const WALDO_ISSUER = 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WALDO_API = process.env.WALDO_API;

// 📢 Welcome & Help
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `👋 *Welcome to WALDOcoin Presale Bot!*\n\nUse the commands:\n/buy - Start presale\n/status - Check if WALDO delivered\n/trustline - Set trustline\n/airdrop - See bonus tiers\n/last - Show your last buy`, { parse_mode: 'Markdown' });
});

// 🧾 Bonus tiers
bot.onText(/\/airdrop/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎁 *WALDO Presale Bonus Tiers:*\n\n💸 80 XRP → +15%\n💸 90 XRP → +22%\n💸 100 XRP → +30%\n\nAll purchases = 10,000 WALDO per XRP.\nBonuses are automatic.\n\nType /buy to get started.`, { parse_mode: 'Markdown' });
});

// 🔐 Set trustline
bot.onText(/\/trustline/, (msg) => {
    const chatId = msg.chat.id;
    const link = `https://xrpl.services/tokens/WLO`;
    bot.sendMessage(chatId, `🛡️ Set your WALDO trustline:\n${link}`);
});

// 💰 Begin buy flow
bot.onText(/\/buy/, (msg) => {
    const chatId = msg.chat.id;
    userSessions.set(chatId, { step: 'amount' });
    bot.sendMessage(chatId, `💰 How much XRP do you want to spend? (1–100 XRP)`);
});

// 📦 Last buy lookup
bot.onText(/\/last/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (!session?.wallet) return bot.sendMessage(chatId, `❌ You must first /buy and enter your wallet.`);
    try {
        const res = await fetch(`${WALDO_API}/api/presale/analytics`, {
            headers: { 'x-admin-key': process.env.ADMIN_KEY }
        });
        const data = await res.json();
        const match = data.recentPurchases.find(p => p.wallet.includes(session.wallet.slice(0, 8)));
        if (!match) return bot.sendMessage(chatId, `❌ No purchase found for ${session.wallet}`);
        bot.sendMessage(chatId, `📦 Last WALDO Buy:\n💸 ${match.xrpAmount} XRP\n🎁 ${match.waldoAmount} WALDO\n📅 ${new Date(match.timestamp).toLocaleString()}`);
    } catch (err) {
        console.error('❌ /last error', err);
        bot.sendMessage(chatId, `⚠️ Failed to fetch your last buy.`);
    }
});

// 🚚 Delivery status check
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (!session?.wallet) return bot.sendMessage(chatId, `❌ You must first /buy and enter your wallet.`);
    try {
        const res = await fetch(`${WALDO_API}/api/presale/analytics`, {
            headers: { 'x-admin-key': process.env.ADMIN_KEY }
        });
        const data = await res.json();
        const match = data.recentPurchases.find(p => p.wallet.includes(session.wallet.slice(0, 8)));
        if (!match) return bot.sendMessage(chatId, `❌ No transaction found for ${session.wallet}`);
        const deliveryKey = `presale:delivery:${match.txHash}`;
        const delivery = await fetch(`${WALDO_API}/redis/hgetall?key=${deliveryKey}`).then(r => r.json());
        if (delivery.status === 'pending') {
            bot.sendMessage(chatId, `⌛ WALDO delivery is still *pending*. Please check again soon.`);
        } else {
            bot.sendMessage(chatId, `✅ WALDO delivery *sent*! Check your wallet.`);
        }
    } catch (err) {
        console.error('❌ /status error', err);
        bot.sendMessage(chatId, `⚠️ Failed to check delivery status.`);
    }
});

// 🧠 Smart input handling
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    const text = msg.text.trim();

    if (!session || !session.step) return;

    // Step 1: XRP Amount
    if (session.step === 'amount') {
        const xrp = parseFloat(text);
        if (isNaN(xrp) || xrp < 1 || xrp > 100) {
            return bot.sendMessage(chatId, `❌ Invalid amount. Enter 1–100 XRP.`);
        }
        session.xrpAmount = xrp;
        session.step = 'wallet';
        bot.sendMessage(chatId, `📬 Now enter your XRPL wallet address:`);
    }

    // Step 2: Wallet
    else if (session.step === 'wallet') {
        if (!text.startsWith('r') || text.length < 25) {
            return bot.sendMessage(chatId, `❌ Invalid XRPL address.`);
        }

        // Check trustline
        try {
            const res = await fetch(`https://xrpl.services/api/v1/account/${text}/trustlines`);
            const { lines } = await res.json();
            const hasTrustline = lines.some(l => l.currency === 'WLO' && l.issuer === WALDO_ISSUER);

            if (!hasTrustline) {
                bot.sendMessage(chatId, `⚠️ *Warning:* WALDO trustline not found for this wallet.\nYou can still continue, but WALDO may not appear until you set the trustline.\nUse /trustline to fix.`, { parse_mode: 'Markdown' });
            }
        } catch (e) {
            console.warn('Trustline check failed:', e.message);
        }

        session.wallet = text;
        session.step = 'ready';
        bot.sendMessage(chatId, `✅ You’re ready to buy *${session.xrpAmount} XRP* worth of WALDO!\nType /pay to continue.`, { parse_mode: 'Markdown' });
    }
});

// 🔗 Trigger XUMM presale payment
bot.onText(/\/pay/, async (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (!session?.wallet || !session.xrpAmount) {
        return bot.sendMessage(chatId, `❌ You must first /buy and enter wallet.`);
    }

    bot.sendMessage(chatId, `⏳ Generating XUMM QR for ${session.xrpAmount} XRP...`);

    try {
        const res = await fetch(`${WALDO_API}/api/presale/buy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                wallet: session.wallet,
                xrpAmount: session.xrpAmount
            })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const caption = `✅ *WALDO Presale Payment Ready!*\n\n💸 ${session.xrpAmount} XRP\n🎁 ${data.calculation.totalWaldo.toLocaleString()} WALDO\n📲 Sign with XUMM below:`;
        bot.sendPhoto(chatId, data.qr, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: 'Open XUMM App', url: data.deeplink }]]
            }
        });

    } catch (err) {
        console.error('❌ Buy error', err);
        bot.sendMessage(chatId, `❌ Failed to create payment. Try again later.`);
    }
});
