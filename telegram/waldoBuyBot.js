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
const client = new xrpl.Client("wss://s.altnet.rippletest.net");

await client.connect();
console.log("🤖 WALDO Telegram Bot is live!");

const sessions = {};

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    sessions[chatId] = {};
    bot.sendMessage(chatId, `👋 Welcome to the WALDOcoin presale bot!\n\nPlease send your XRPL wallet address (XUMM / XAMAN).`);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Ignore commands
    if (!msg.text || msg.text.startsWith("/")) return;

    const text = msg.text.trim();

    // Step 1: Collect wallet
    if (!sessions[chatId]?.wallet) {
        if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)) {
            return bot.sendMessage(chatId, "❌ That doesn't look like a valid XRPL wallet. Please try again.");
        }

        sessions[chatId].wallet = text;
        return bot.sendMessage(chatId, `✅ Wallet saved: ${text}\n\nNow, how much XRP do you want to send?\n\nMinimum: 1 XRP\n\n🎁 Bonus tiers:\n5 XRP → +5%\n10 XRP → +10%\n20 XRP → +12%\n40 XRP → +14%\n80 XRP → +15%\n90 XRP → +22%\n100 XRP → +30%`);
    }

    // Step 2: Amount to buy
    const walletAddr = sessions[chatId].wallet;
    const xrpAmount = parseFloat(text);

    if (isNaN(xrpAmount) || xrpAmount < 1) {
        return bot.sendMessage(chatId, `❌ Please enter a valid amount (minimum 1 XRP).`);
    }

    const baseWaldo = xrpAmount * 10000;
    const bonusRate = BONUS_TIERS[xrpAmount.toString()] || 0;
    const bonus = Math.floor(baseWaldo * bonusRate);
    const totalWaldo = baseWaldo + bonus;

    // Trustline check
    try {
        const accountLines = await client.request({
            command: "account_lines",
            account: walletAddr
        });

        const trustlineExists = accountLines.result.lines.some(
            line => line.currency === WALDO_TOKEN && line.issuer === WALDO_ISSUER
        );

        if (!trustlineExists) {
            return bot.sendMessage(chatId, `⚠️ You must first set a trustline to WALDO ($WLO).\n\n👉 Go to https://xrpl.services/tokens → Search "WLO" → Click Add Trustline`);
        }
    } catch (err) {
        console.error(err);
        return bot.sendMessage(chatId, `❌ Error checking trustline. Try again later.`);
    }

    // Send WALDO
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
            bot.sendMessage(chatId, `🎉 Sent ${totalWaldo} WALDO to ${walletAddr}!\n\n✅ Tx Hash:\nhttps://testnet.xrpl.org/transactions/${signed.hash}`);
        } else {
            bot.sendMessage(chatId, `❌ Transaction failed: ${result.result.meta.TransactionResult}`);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Transaction failed. Please try again later.`);
    }

    // Reset session
    delete sessions[chatId];
});

