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

// 📍 Trigger bot with /buywaldo (to avoid /start conflicts)
bot.onText(/\/buywaldo/, (msg) => {
    const chatId = msg.chat.id;
    sessions[chatId] = {};
    bot.sendMessage(chatId, `👋 Welcome to the *WALDOcoin Presale Bot*!\n\nSend me your XRPL wallet address (XUMM / XAMAN) to begin:`, {
        parse_mode: "Markdown"
    });
});

// 📍 Handle all text messages (wallet address + XRP amount)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text.trim();
    const session = sessions[chatId];

    // Step 1: Save wallet
    if (!session?.wallet) {
        if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(text)) {
            return bot.sendMessage(chatId, "❌ Invalid XRPL wallet. Please try again.");
        }

        sessions[chatId] = { wallet: text };
        return bot.sendMessage(chatId, `✅ Wallet saved: *${text}*\n\nNow enter how much XRP you want to send:\n\n1 XRP ➡️ 10,000 WALDO\n10 XRP ➡️ 100,000 WALDO\n100 XRP ➡️ 1,000,000 WALDO + bonuses!`, {
            parse_mode: "Markdown"
        });
    }

    // Step 2: Handle amount
    const walletAddr = session.wallet;
    const xrpAmount = parseFloat(text);

    if (!xrpAmount || xrpAmount < 1) {
        return bot.sendMessage(chatId, `❌ Please enter a valid XRP amount (minimum 1 XRP).`);
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

        const hasTrustline = accountLines.result.lines.some(
            line => line.currency === WALDO_TOKEN && line.issuer === WALDO_ISSUER
        );

        if (!hasTrustline) {
            return bot.sendMessage(chatId, `⚠️ You must set a trustline first:\n👉 https://xrpl.services/tokens (search "WLO")`);
        }
    } catch (err) {
        console.error(err);
        return bot.sendMessage(chatId, `❌ Error verifying trustline. Please try again later.`);
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
            bot.sendMessage(chatId, `🎉 Sent *${totalWaldo} WALDO* to *${walletAddr}*!\n\n✅ Tx Hash: [${signed.hash}](https://testnet.xrpl.org/transactions/${signed.hash})`, {
                parse_mode: "Markdown"
            });
        } else {
            bot.sendMessage(chatId, `❌ Transaction failed: ${result.result.meta.TransactionResult}`);
        }
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, `❌ Transaction failed. Please try again later.`);
    }

    delete sessions[chatId]; // Reset session
});


