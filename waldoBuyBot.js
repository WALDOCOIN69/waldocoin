// WALDO Buy Bot with group detection, DM flow, trustline check, bonuses, auto WALDO sender
import { config } from "dotenv";
config();

import TelegramBot from "node-telegram-bot-api";
import xrpl from "xrpl";
import Redis from "ioredis";
import fetch from "node-fetch";

// Debug bot token
console.log('🔍 BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('🔍 BOT_TOKEN length:', process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0);
console.log('🔍 BOT_TOKEN starts with:', process.env.BOT_TOKEN ? process.env.BOT_TOKEN.substring(0, 10) + '...' : 'undefined');

// Custom HTTP-based bot to bypass library issues
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Custom bot functions using direct HTTP
async function sendMessage(chatId, text, options = {}) {
    try {
        const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: options.parse_mode || 'Markdown',
                ...options
            })
        });
        return await response.json();
    } catch (error) {
        console.error('❌ Send message error:', error.message);
        return null;
    }
}

// Simple polling mechanism
let pollingActive = false;
let lastUpdateId = 0;
let messageHandler = null; // Will be set by startBuyBot

async function pollUpdates() {
    if (!pollingActive) return;

    try {
        const response = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`);
        const data = await response.json();

        console.log(`🔄 Polling check - Updates: ${data.result ? data.result.length : 0}`);

        if (data.ok && data.result.length > 0) {
            console.log(`📨 Processing ${data.result.length} updates`);
            for (const update of data.result) {
                lastUpdateId = update.update_id;
                console.log(`📩 Update ${update.update_id}: ${update.message ? 'Message' : 'Other'}`);
                if (update.message && messageHandler) {
                    console.log(`💬 Message from ${update.message.from.username || update.message.from.first_name}: ${update.message.text}`);
                    await messageHandler(update.message);
                }
            }
        }
    } catch (error) {
        console.error('❌ Polling error:', error.message);
    }

    // Continue polling
    setTimeout(pollUpdates, 1000);
}

// Legacy bot object for compatibility (disabled)
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const client = new xrpl.Client(process.env.XRPL_ENDPOINT);
const redis = new Redis(process.env.REDIS_URL);

export async function startBuyBot() {
    // Test bot token with custom HTTP bot
    try {
        console.log('🔍 Testing bot token with custom HTTP bot...');
        const testUrl = `${TELEGRAM_API}/getMe`;
        const response = await fetch(testUrl);
        const data = await response.json();

        if (data.ok) {
            console.log(`✅ Custom HTTP bot successful: @${data.result.username}`);
            console.log(`🤖 Bot ID: ${data.result.id}`);

            // Test manual update fetch first
            console.log('🔍 Testing manual getUpdates...');
            const testResponse = await fetch(`${TELEGRAM_API}/getUpdates`);
            const testData = await testResponse.json();
            console.log('📋 Manual getUpdates result:', JSON.stringify(testData, null, 2));

            // Clear any pending updates first
            console.log('🧹 Clearing pending updates...');
            const clearResponse = await fetch(`${TELEGRAM_API}/getUpdates?offset=-1`);
            const clearData = await clearResponse.json();
            console.log(`🧹 Cleared ${clearData.result ? clearData.result.length : 0} pending updates`);

            // Set the message handler for polling
            messageHandler = handleMessage;

            // Start custom polling
            pollingActive = true;
            pollUpdates();
            console.log('🔄 Custom bot polling started with message handler');
        } else {
            console.error('❌ Custom HTTP bot failed:', data);
            return;
        }
    } catch (error) {
        console.error('❌ Custom HTTP bot error:', error.message);
        return;
    }

    await client.connect();
    console.log("✅ WALDO Buy Bot connected to XRPL");

    const distributorWallet = xrpl.Wallet.fromSeed(process.env.WALDO_DISTRIBUTOR_SECRET);
    const issuer = process.env.WALDO_ISSUER;
    const NFT_ENABLED = process.env.NFT_BADGE_ENABLED === "true";

    const greetedKey = (id) => `greeted:${id}`;
    const processedTxKey = (hash) => `tx:${hash}`;
    const rateLimit = new Map();

    // Custom message handler
    async function handleMessage(msg) {
        console.log(`🎯 Handling message from ${msg.from.username || msg.from.first_name} in ${msg.chat.type}`);
        const chatId = msg.chat.id;
        const text = (msg.text || "").toLowerCase();
        console.log(`📝 Message text: "${text}"`);
        console.log(`💬 Chat type: ${msg.chat.type}, Chat ID: ${chatId}`);

        // Skip empty messages
        if (!text) {
            console.log('⚠️ Empty message, skipping...');
            return;
        }

        // Group chat trigger (case-insensitive)
        if (msg.chat.type.endsWith("group") && text.includes("@waldocoinbuybot")) {
            console.log('🎯 Group mention detected! Sending presale message...');
            const WALDO_ISSUER = process.env.WALDO_ISSUER;

            const markdownMessage = `
📌 *WALDOcoin Presale Bot is Live!*
Buy WLO instantly with XRP — no waiting, no middlemen.

🚀 *How to get started:*
1️⃣ DM 👉 [@WALDOCOINbuyBot](https://t.me/WALDOCOINbuyBot)
2️⃣ Type */buywaldo*
3️⃣ Paste your *XRPL Wallet Address*
4️⃣ Send XRP → Get WLO instantly (bonus tiers apply!)

💰 *BONUS TIERS*
- 80 XRP = +15%
- 90 XRP = +22%
- 100 XRP = +30%

🛡️ *Set Trustline (required)*:
👉 [Set Trustline](https://xrpl.services/?issuer=${WALDO_ISSUER}&currency=WLO&limit=976849999)

🌐 [Visit WALDOcoin.live](https://waldocoin.live)
📣 [X (Twitter)](https://x.com/W_A_L_D_O_coin)
      `;

            const result = await sendMessage(chatId, markdownMessage, {
                parse_mode: "Markdown",
                disable_web_page_preview: false,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "💸 DM Buy Bot", url: "https://t.me/WALDOCOINbuyBot" },
                            { text: "🛡️ Set Trustline", url: `https://xrpl.services/?issuer=${WALDO_ISSUER}&currency=WLO&limit=976849999` },
                        ],
                        [
                            { text: "🌐 WALDOcoin.live", url: "https://waldocoin.live" },
                            { text: "📣 X (Twitter)", url: "https://x.com/W_A_L_D_O_coin" },
                        ],
                    ],
                },
            });
            console.log('📤 Group message send result:', result ? 'Success' : 'Failed');
            return;
        }

        // DM flow
        const isPrivate = msg.chat.type === "private";
        if (isPrivate) {
            if (rateLimit.has(chatId) && Date.now() - rateLimit.get(chatId) < 3000) return;
            rateLimit.set(chatId, Date.now());

            const exists = await redis.exists(greetedKey(chatId));
            if (!exists) {
                const welcomeMessage = "👋 *Welcome to the WALDOcoin Buy Bot (Mainnet)*\n\n" +
                    "Steps:\n" +
                    "1️⃣ Send your XRPL wallet address\n" +
                    "2️⃣ Send XRP to: `" + distributorWallet.classicAddress + "`\n" +
                    "3️⃣ WLO will be sent automatically with bonuses\n\n" +
                    "💡 *Bonus Tiers:*\n" +
                    "80 XRP = +15%\n" +
                    "90 XRP = +22%\n" +
                    "100 XRP = +30%\n\n" +
                    "💰 *Min Buy:* 5 XRP\n" +
                    "🔗 Set trustline: https://waldocoin.live";

                await sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
                await redis.set(greetedKey(chatId), "1");
                return;
            }

            if (text.startsWith("r") && text.length >= 25 && text.length <= 35) {
                const walletMessage = "✅ Wallet received: `" + text + "`\n" +
                    "Now send XRP to: `" + distributorWallet.classicAddress + "`\n\n" +
                    "I'll check for payment every 60 seconds.";

                await sendMessage(chatId, walletMessage, { parse_mode: "Markdown" });
                const interval = setInterval(() => checkIncoming(text, chatId), 60000);
                setTimeout(() => clearInterval(interval), 1800000);
            } else {
                await sendMessage(chatId, "❌ Invalid XRPL address. Please try again.");
            }
        }
    }

    function calcWaldoBonus(xrpAmount) {
        const base = xrpAmount * 10000;
        if (xrpAmount >= 100) return Math.floor(base * 1.3);
        if (xrpAmount >= 90) return Math.floor(base * 1.22);
        if (xrpAmount >= 80) return Math.floor(base * 1.15);
        return base;
    }

    async function hasTrustline(address) {
        const acc = await client.request({ command: "account_lines", account: address });
        return acc.result.lines.some((line) => line.currency === "WLO" && line.account === issuer);
    }

    async function sendWaldo(to, amount, tag) {
        const tx = {
            TransactionType: "Payment",
            Account: distributorWallet.classicAddress,
            Destination: to,
            Amount: {
                currency: "WLO",
                issuer,
                value: amount.toString(),
            },
            DestinationTag: tag || undefined,
        };
        const prepared = await client.autofill(tx);
        const signed = distributorWallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        return result.result.hash;
    }

    async function mintNFTBadge(to) {
        if (!NFT_ENABLED) return null;
        const tx = {
            TransactionType: "NFTokenMint",
            Account: distributorWallet.classicAddress,
            URI: xrpl.convertStringToHex(`WALDO Presale Badge for ${to}`),
            Flags: 8,
            TransferFee: 0,
            NFTokenTaxon: 0,
        };
        const prepared = await client.autofill(tx);
        const signed = distributorWallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        return result.result.hash;
    }

    async function reportPurchaseToBackend(wallet, xrpAmount, waldoAmount, txHash) {
        try {
            const backendUrl = process.env.BACKEND_API_URL || 'https://waldocoin-backend-api.onrender.com';
            const response = await fetch(`${backendUrl}/api/presale/bot-purchase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    wallet,
                    xrpAmount,
                    waldoAmount,
                    txHash,
                    botSource: 'telegram'
                })
            });

            const result = await response.json();
            if (result.success) {
                console.log(`✅ Purchase reported to backend: ${txHash}`);
            } else {
                console.error(`❌ Failed to report purchase to backend: ${result.error}`);
            }
        } catch (error) {
            console.error(`❌ Error reporting purchase to backend:`, error.message);
        }
    }

    async function checkIncoming(wallet, chatId) {
        const txs = await client.request({
            command: "account_tx",
            account: distributorWallet.classicAddress,
            ledger_index_min: -1,
            ledger_index_max: -1,
            binary: false,
            limit: 20,
        });

        for (const { tx } of txs.result.transactions) {
            if (tx.TransactionType !== "Payment") continue;
            if (tx.Destination !== distributorWallet.classicAddress) continue;
            if (tx.Account !== wallet) continue;

            const hashKey = processedTxKey(tx.hash);
            if (await redis.exists(hashKey)) continue;

            const amount = parseFloat(tx.Amount) / 1_000_000;
            if (amount < 5) continue;

            const waldo = calcWaldoBonus(amount);
            const hasLine = await hasTrustline(wallet);

            if (!hasLine) {
                await sendMessage(chatId, "⚠️ WLO trustline not found. Please set it first:\nhttps://waldocoin.live");
                continue;
            }

            const waldoTx = await sendWaldo(wallet, waldo);
            let nftTx = null;
            if (NFT_ENABLED) nftTx = await mintNFTBadge(wallet);

            await redis.set(
                hashKey,
                JSON.stringify({ wallet, amount, waldo, waldoTx, nftTx, date: Date.now() })
            );

            // Report purchase to backend API for tracking
            await reportPurchaseToBackend(wallet, amount, waldo, tx.hash);

            // FIXED: Build confirmation message properly
            let confirmationMessage = `✅ Payment confirmed!\n\n💸 Sent: ${amount} XRP\n🎁 WLO: ${waldo}\n📦 TX: https://livenet.xrpl.org/transactions/${waldoTx}`;

            if (nftTx) {
                confirmationMessage += `\n🏅 NFT: https://livenet.xrpl.org/transactions/${nftTx}`;
            }

            await sendMessage(chatId, confirmationMessage, { parse_mode: "Markdown" });
        }
    }

    // OLD EVENT HANDLERS REMOVED - Using custom handleMessage function instead
    console.log('✅ Custom bot setup complete');
}



