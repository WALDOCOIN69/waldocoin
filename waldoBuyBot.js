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
                console.log(`✅ Valid wallet address received: ${text}`);

                const walletMessage = "✅ Wallet received: `" + text + "`\n" +
                    "Now send XRP to: `" + distributorWallet.classicAddress + "`\n\n" +
                    "I'll check for payment every 10 seconds.";

                console.log(`📨 Sending wallet confirmation message...`);
                const result = await sendMessage(chatId, walletMessage, { parse_mode: "Markdown" });
                console.log(`📨 Wallet message result:`, result ? 'Success' : 'Failed');

                console.log(`⏰ Starting payment monitoring for ${text} - checking every 10 seconds`);
                const interval = setInterval(() => checkIncoming(text, chatId), 10000); // 10 seconds instead of 60
                setTimeout(() => clearInterval(interval), 1800000);
            } else {
                console.log(`❌ Invalid wallet address: ${text} (length: ${text.length})`);
                await sendMessage(chatId, "❌ Invalid XRPL address. Please try again.");
            }
        }
    }

    // Copy exact calculation logic from presale backend
    function calcWaldoBonus(xrpAmount) {
        const WALDO_PER_XRP = 10000; // Same as presale backend

        // Same bonus logic as presale backend
        let bonus = 0;
        if (xrpAmount === 80) bonus = 120_000; // 15% bonus
        if (xrpAmount === 90) bonus = 198_000; // 22% bonus
        if (xrpAmount === 100) bonus = 300_000; // 30% bonus

        const totalWaldo = xrpAmount * WALDO_PER_XRP + bonus;
        return totalWaldo;
    }

    async function hasTrustline(address) {
        const acc = await client.request({ command: "account_lines", account: address });
        return acc.result.lines.some((line) => line.currency === "WLO" && line.account === issuer);
    }

    // Copy exact working logic from presale backend
    async function sendWaldo(to, amount, tag) {
        try {
            console.log(`💸 Attempting to send ${amount} WLO to ${to}`);

            // Use exact same transaction structure as working presale backend
            const transaction = {
                TransactionType: "Payment",
                Account: distributorWallet.classicAddress,
                Destination: to,
                Amount: {
                    currency: "WLO",
                    issuer,
                    value: parseFloat(amount).toFixed(6)  // Same as presale backend
                }
            };

            console.log(`📝 Transaction prepared using presale backend pattern`);

            const prepared = await client.autofill(transaction);
            const signed = distributorWallet.sign(prepared);
            const result = await client.submitAndWait(signed.tx_blob);

            if (result.result.meta.TransactionResult === "tesSUCCESS") {
                console.log(`✅ WALDO sent successfully! Hash: ${result.result.hash}`);
                return result.result.hash;
            } else {
                throw new Error(`Transaction failed: ${result.result.meta.TransactionResult}`);
            }

        } catch (error) {
            console.error(`❌ Error sending WALDO:`, error.message);
            throw error;
        }
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
        console.log(`🔍 Checking for payments from ${wallet} to ${distributorWallet.classicAddress}`);

        const txs = await client.request({
            command: "account_tx",
            account: distributorWallet.classicAddress,
            ledger_index_min: -1,
            ledger_index_max: -1,
            binary: false,
            limit: 20,
        });

        console.log(`📋 Found ${txs.result.transactions.length} total transactions to check`);

        for (const transaction of txs.result.transactions) {
            // Fix: Use tx_json which contains the actual transaction data
            const tx = transaction.tx_json || transaction.tx || transaction;
            if (!tx || tx.TransactionType !== "Payment") {
                console.log(`⏭️ Skipping non-payment transaction: ${tx ? tx.TransactionType : 'undefined'}`);
                continue;
            }

            console.log(`✅ Found Payment transaction from ${tx.Account} to ${tx.Destination} - AMOUNT DEBUG DEPLOYED!`);
            if (tx.Destination !== distributorWallet.classicAddress) {
                console.log(`⏭️ Skipping transaction to different destination: ${tx.Destination}`);
                continue;
            }
            if (tx.Account.toLowerCase() !== wallet.toLowerCase()) {
                console.log(`⏭️ Skipping transaction from different account: ${tx.Account} (looking for ${wallet})`);
                continue;
            }

            // Create unique key using multiple transaction properties
            const uniqueKey = `${tx.Account}-${tx.Destination}-${tx.Sequence || tx.date || Date.now()}`;
            const hashKey = processedTxKey(tx.hash || uniqueKey);
            if (await redis.exists(hashKey)) {
                console.log(`⏭️ Transaction already processed: ${tx.hash || uniqueKey}`);
                continue;
            }

            // Debug: Log the transaction amount structure
            console.log(`🔍 Transaction amount debug:`, {
                Amount: tx.Amount,
                DeliverMax: tx.DeliverMax,
                type: typeof tx.Amount
            });

            // Handle both string and object amounts, also check DeliverMax
            let amount;
            if (typeof tx.Amount === 'string') {
                amount = parseFloat(tx.Amount) / 1_000_000;
            } else if (typeof tx.Amount === 'object' && tx.Amount.value) {
                amount = parseFloat(tx.Amount.value);
            } else if (typeof tx.DeliverMax === 'string') {
                // Try DeliverMax for newer transactions
                amount = parseFloat(tx.DeliverMax) / 1_000_000;
            } else if (typeof tx.DeliverMax === 'object' && tx.DeliverMax.value) {
                amount = parseFloat(tx.DeliverMax.value);
            } else {
                console.log(`⚠️ Unknown amount format - Amount:`, tx.Amount, `DeliverMax:`, tx.DeliverMax);
                continue;
            }
            console.log(`💰 Found valid payment: ${amount} XRP from ${tx.Account}`);

            if (amount < 5) {
                console.log(`⚠️ Payment too small: ${amount} XRP (minimum 5 XRP)`);
                continue;
            }

            const waldo = calcWaldoBonus(amount);
            console.log(`🎁 Calculated WALDO reward: ${waldo} WLO`);

            // Use original case wallet address for XRPL API calls
            const originalWallet = tx.Account;
            const hasLine = await hasTrustline(originalWallet);
            console.log(`🔗 Trustline check for ${originalWallet}: ${hasLine ? 'Found' : 'Not found'}`);

            if (!hasLine) {
                console.log(`❌ Sending trustline warning to user`);
                await sendMessage(chatId, "⚠️ WLO trustline not found. Please set it first:\nhttps://waldocoin.live");
                continue;
            }

            console.log(`🚀 Processing payment: ${amount} XRP → ${waldo} WLO`);

            try {
                const waldoTx = await sendWaldo(originalWallet, waldo);
                console.log(`✅ WALDO transaction completed: ${waldoTx}`);

                let nftTx = null;
                if (NFT_ENABLED) {
                    console.log(`🏅 Minting NFT badge...`);
                    nftTx = await mintNFTBadge(originalWallet);
                    console.log(`✅ NFT minted: ${nftTx}`);
                }

                await redis.set(
                    hashKey,
                    JSON.stringify({ wallet: originalWallet, amount, waldo, waldoTx, nftTx, date: Date.now() })
                );
                console.log(`💾 Transaction marked as processed in Redis`);

                // Report purchase to backend API for tracking
                const txHashForReporting = tx.hash || waldoTx || `bot-${Date.now()}-${originalWallet.slice(-8)}`;
                await reportPurchaseToBackend(originalWallet, amount, waldo, txHashForReporting);
                console.log(`📊 Purchase reported to backend API with hash: ${txHashForReporting}`);

                // FIXED: Build confirmation message properly
                let confirmationMessage = `✅ Payment confirmed!\n\n💸 Sent: ${amount} XRP\n🎁 WLO: ${waldo}\n📦 TX: https://livenet.xrpl.org/transactions/${waldoTx}`;

                if (nftTx) {
                    confirmationMessage += `\n🏅 NFT: https://livenet.xrpl.org/transactions/${nftTx}`;
                }

                await sendMessage(chatId, confirmationMessage, { parse_mode: "Markdown" });
                console.log(`📨 Confirmation message sent to user`);

            } catch (error) {
                console.error(`❌ Error processing payment:`, error.message);
                console.error(`❌ Full error details:`, error);
                await sendMessage(chatId, `❌ Error processing your payment. Please contact support.`);
            }
        }
    }

    // OLD EVENT HANDLERS REMOVED - Using custom handleMessage function instead
    console.log('✅ Custom bot setup complete');
}



