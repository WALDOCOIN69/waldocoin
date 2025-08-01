import TelegramBot from 'node-telegram-bot-api';
import xrpl from 'xrpl';
import dotenv from 'dotenv';

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const WALDO_ISSUER = process.env.WALDO_ISSUER;
const WALDO_TOKEN = process.env.WALDO_TOKEN || "WLO";
const WALDO_DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET;
const BONUS_TIERS = JSON.parse(process.env.BONUS_TIERS_JSON || '{}');

const wallet = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
const client = new xrpl.Client("wss://s.altnet.rippletest.net"); // XRPL testnet
await client.connect();

console.log("🤖 WALDO Telegram Bot is live!");

const sessions = {};

// 🟢 START FLOW
bot.onText(/\/buywaldo/, (msg) => {
    const chatId = msg.chat.id;
    sessions[chatId] = {};
    bot.sendMessage(chatId, `👋 Welcome to the *WALDOcoin* presale bot!

To begin, please *send your XRPL wallet address* (XUMM/XAMAN).`, {
        parse_mode: "Markdown",
    });
});

// 🔁 CONTINUED FLOW
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // 🛑 Ignore commands or empty text
    if (!text || text.startsWith("/")) return;

    // Step 1: Save wallet
    if (!sessions[chatId]?.wallet) {
        if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)) {
            return bot.sendMessage(chatId, "❌ Invalid XRPL address. Please try again.");
        }

        sessions[chatId] = { wallet: text };
        return bot.sendMessage(chatId, `✅ Wallet saved: \`${text}\`

Now send the amount of *XRP* you want to spend.

You can send *any amount* (minimum 1 XRP).
Bonus tiers:
• 80 XRP ➕ 15%
• 90 XRP ➕ 22%
• 100 XRP ➕ 30%`, { parse_mode: "Markdown" });
    }

    // Step 2: Process XRP amount
    const walletAddr = sessions[chatId].wallet;
    const xrpAmount = parseFloat(text);
    if (!xrpAmount || xrpAmount < 1) {
        return bot.sendMessage(chatId, "❌ Please enter a valid XRP amount (minimum 1).");
    }

    const bonusRate = BONUS_TIERS[xrpAmount.toString()] || 0;
    const baseWaldo = xrpAmount * 10000;
    const bonus = Math.floor(baseWaldo * bonusRate);
    const totalWaldo = baseWaldo + bonus;

    // Step 3: Check trustline
    const accountLines = await client.request({
        command: "account_lines",
        account: walletAddr,
    });

    const trustlineExists = accountLines.result.lines.some(
        (line) => line.currency === WALDO_TOKEN && line.issuer === WALDO_ISSUER
    );

    if (!trustlineExists) {
        return bot.sendMessage(chatId, `⚠️ You must first *set a trustline* to WALDO ($WLO):

👉 https://xrpl.services/?issuer=${WALDO_ISSUER}&currency=WLO&limit=976849999`, {
            parse_mode: "Markdown",
        });
    }

    // Step 4: Send WALDO
    try {
        const tx = await client.autofill({
            TransactionType: "Payment",
            Account: wallet.classicAddress,
            Destination: walletAddr,
            Amount: {
                currency: WALDO_TOKEN,
                issuer: WALDO_ISSUER,
                value: totalWaldo.toString(),
            },
        });

        const signed = wallet.sign(tx);
        const result = await client.submitAndWait(signed.tx_blob);

        if (result.result.meta.TransactionResult === "tesSUCCESS") {
            bot.sendMessage(chatId, `🎉 Sent *${totalWaldo} WALDO* to \`${walletAddr}\`!

✅ [Tx Hash](https://xrpscan.com/tx/${signed.hash})`, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });
        } else {
            bot.sendMessage(chatId, `❌ Error: ${result.result.meta.TransactionResult}`);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Transaction failed. Try again later.`);
    }

    delete sessions[chatId];
});

// 📣 Detect @WALDOCOINbuyBot in group chat
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type.endsWith("group") && msg.text?.toLowerCase().includes("@waldocoinbuybot")) {
        const pinMessage = `
📌 *WALDOcoin Presale Bot is Live!*
Buy WALDO instantly with XRP.

💥 To start:
→ *DM @WaldoBuyBot*
→ Send */buywaldo*
→ Enter your *XRPL wallet*
→ Choose how much XRP
→ Get WALDO instantly (bonuses apply!)

🛡️ *Set your trustline first*:
👉 https://xrpl.services/?issuer=${WALDO_ISSUER}&currency=WLO&limit=976849999

🌐 [waldocoin.live](https://waldocoin.live)
📣 [t.me/WALDOcoinXRP](https://t.me/WALDOcoinXRP)
    `;
        bot.sendMessage(chatId, pinMessage, { parse_mode: "Markdown" });
    }
});



