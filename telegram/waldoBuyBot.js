import TelegramBot from 'node-telegram-bot-api';
import xrpl from 'xrpl';
import dotenv from 'dotenv';

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const WALDO_ISSUER = process.env.WALDO_ISSUER;
const WALDO_TOKEN = process.env.WALDO_TOKEN || "WLO";
const WALDO_DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET;

const BONUS_TIERS = JSON.parse(process.env.BONUS_TIERS_JSON || '{}');

// 📍 START: Wallet + client setup
const wallet = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
const client = new xrpl.Client("wss://s.altnet.rippletest.net"); // use mainnet if needed

await client.connect();
// ✅ Ready
console.log("🤖 WALDO Telegram Bot is live!");

const sessions = {};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    sessions[chatId] = {};
    bot.sendMessage(chatId, `👋 Welcome to the WALDOcoin presale bot!\n\nPlease send your XRPL wallet address (XUMM / XAMAN).`);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Ignore /start, already handled
    if (text.startsWith("/")) return;

    if (!sessions[chatId]?.wallet) {
        // Validate XRPL wallet
        if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)) {
            bot.sendMessage(chatId, "❌ That doesn't look like a valid XRPL wallet. Please try again.");
            return;
        }

        sessions[chatId].wallet = text;
        bot.sendMessage(chatId, `✅ Wallet saved: ${text}\n\nNow, how much XRP do you want to send?\nAvailable tiers:\n\n5 XRP\n10 XRP\n20 XRP\n40 XRP\n80 XRP\n90 XRP\n100 XRP`);
        return;
    }

    const walletAddr = sessions[chatId].wallet;

    const xrpAmount = parseFloat(text);
    if (!xrpAmount || isNaN(xrpAmount) || xrpAmount <= 0) {
        bot.sendMessage(chatId, `❌ Please enter a valid XRP amount from the available tiers.`);
        return;
    }

    const bonusRate = BONUS_TIERS[xrpAmount.toString()] || 0;
    const baseWaldo = xrpAmount * 10000;
    const bonus = Math.floor(baseWaldo * bonusRate);
    const totalWaldo = baseWaldo + bonus;

    // 📍 Trustline check
    const accountLines = await client.request({
        command: "account_lines",
        account: walletAddr
    });

    const trustlineExists = accountLines.result.lines.some(
        line => line.currency === WALDO_TOKEN && line.issuer === WALDO_ISSUER
    );

    if (!trustlineExists) {
        bot.sendMessage(chatId, `⚠️ You must first set a trustline to WALDO ($WLO).\nVisit: https://xrpl.services/tokens → Search "WLO" → Add Trustline.`);
        return;
    }

    // 📍 Send WALDO
    try {
        const tx = await client.autofill({
            TransactionType: "Payment",
            Account: wallet.classicAddress,
            Destination: walletAddr,
            Amount: {
                currency: WALDO_TOKEN,
                issuer: WALDO_ISSUER,
                value: totalWaldo.toString()
            }
        });

        const signed = wallet.sign(tx);
        const result = await client.submitAndWait(signed.tx_blob);

        if (result.result.meta.TransactionResult === "tesSUCCESS") {
            bot.sendMessage(chatId, `🎉 Sent ${totalWaldo} WALDO to ${walletAddr}!\n\n✅ Tx Hash: ${signed.hash}`);
        } else {
            bot.sendMessage(chatId, `❌ Error: ${result.result.meta.TransactionResult}`);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Transaction failed. Please try again later.`);
    }

    // 🔁 Reset session
    delete sessions[chatId];
});

