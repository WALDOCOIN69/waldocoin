import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY;
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'https://your-waldo-backend.com';

if (!BOT_TOKEN) {
    throw new Error("❌ BOT_TOKEN not set in environment variables.");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 WALDO Telegram Bot is live!');

// /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const message = `🧢 Welcome to WALDOcoin!

🔥 You can join the presale at:
👉 https://waldocoin.live/presale

💰 Use /buy <amount> to simulate a purchase.
💡 Example: /buy 100
💻 Use /debugsend <wallet> <amount> (admin only)

#MEMEconomy #WALDOcoin`;

    bot.sendMessage(chatId, message);
});

// /buy command
bot.onText(/\/buy (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = parseFloat(match[1]);

    if (isNaN(amount) || amount < 1) {
        bot.sendMessage(chatId, `❌ Invalid amount. Example: /buy 100`);
        return;
    }

    try {
        const res = await fetch(`${BACKEND_BASE_URL}/api/presale/calculate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ xrp: amount })
        });

        const json = await res.json();
        const { waldo, bonusPercent, total } = json;

        bot.sendMessage(chatId, `✅ You will receive:
🪙 WALDO: ${waldo}
🎁 Bonus: +${bonusPercent}%
🏁 Total: ${total} WALDO`);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Could not calculate purchase. Try again later.`);
    }
});

// /debugsend command for manual test WALDO sends
bot.onText(/\/debugsend (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const wallet = match[1]?.trim();
    const amount = match[2]?.trim();

    if (!wallet || !amount || isNaN(amount)) {
        bot.sendMessage(chatId, `❌ Usage: /debugsend <wallet_address> <amount>`);
        return;
    }

    bot.sendMessage(chatId, `🚀 Sending ${amount} WALDO to wallet:\n\`${wallet}\`\nStandby...`, { parse_mode: "Markdown" });

    try {
        const res = await fetch(`${BACKEND_BASE_URL}/api/debug/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-key": ADMIN_KEY
            },
            body: JSON.stringify({ wallet, amount })
        });

        const json = await res.json();
        if (res.ok) {
            bot.sendMessage(chatId, `✅ TX sent!\nExplorer: ${json.txUrl || "N/A"}`);
        } else {
            bot.sendMessage(chatId, `❌ Failed to send: ${json.error || "Unknown error"}`);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Internal error occurred.`);
    }
});

