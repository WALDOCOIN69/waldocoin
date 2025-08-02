import TelegramBot from "node-telegram-bot-api";
import xrpl from "xrpl";
import Redis from "ioredis";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false }); // Disabled - Using webhooks
const client = new xrpl.Client(process.env.XRPL_ENDPOINT);
const redis = new Redis(process.env.REDIS_URL);

// Debug Redis connection
redis.on('connect', () => {
    console.log('✅ Bot Redis connected');
});

redis.on('error', (err) => {
    console.error('❌ Bot Redis error:', err.message);
});

redis.on('ready', () => {
    console.log('🚀 Bot Redis ready');
});

export async function startBuyBot() {
    // Force stop any existing polling first
    try {
        await bot.stopPolling();
        console.log("🛑 Stopped any existing polling");
    } catch (e) {
        console.log("ℹ️ No existing polling to stop");
    }

    // Add delay to prevent conflicts with other instances
    console.log("⏳ Starting bot in 10 seconds...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    await client.connect();
    console.log("✅ WALDO Buy Bot connected to XRPL");

    console.log("🔍 BOT_TOKEN exists:", !!process.env.BOT_TOKEN);
    console.log("🔍 BOT_TOKEN length:", process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0);

    // Test bot token and get bot info
    try {
        const botInfo = await bot.getMe();
        console.log("✅ Bot info:", botInfo.username, "-", botInfo.first_name);
        console.log("🔗 Bot link: https://t.me/" + botInfo.username);

        // Check and clear any existing webhook
        const webhookInfo = await bot.getWebHookInfo();
        console.log("🔍 Webhook info:", webhookInfo);
        if (webhookInfo.url) {
            console.log("🗑️ Removing existing webhook:", webhookInfo.url);
            await bot.deleteWebHook();
            console.log("✅ Webhook removed");
        }
    } catch (error) {
        console.error("❌ Bot token error:", error.message);
        return;
    }

    // Use webhooks instead of polling to avoid conflicts
    console.log("🌐 Setting up webhook instead of polling...");
    const webhookUrl = `${process.env.RENDER_EXTERNAL_URL || 'https://waldocoin-backend-api.onrender.com'}/webhook/telegram`;
    await bot.setWebHook(webhookUrl);
    console.log("✅ Webhook set:", webhookUrl);

    // Process webhook updates manually
    bot.processUpdate = (update) => {
        console.log("🔄 Bot processing update:", update?.message?.text || 'no text');
        if (update.message) {
            bot.emit('message', update.message);
        }
    };

    // Make bot available globally for webhook processing
    global.telegramBot = bot;
    console.log("🌐 Bot made available globally for webhook processing");

    // Only error handler (no polling error handler)
    bot.on('error', (error) => {
        console.error('❌ Bot error:', error);
    });

    console.log("✅ Webhook mode activated - no polling");

    const distributorWallet = xrpl.Wallet.fromSeed(process.env.WALDO_DISTRIBUTOR_SECRET);
    const issuer = process.env.WALDO_ISSUER;
    const NFT_ENABLED = process.env.NFT_BADGE_ENABLED === "true";

    const greetedKey = (id) => `greeted:${id}`;
    const processedTxKey = (hash) => `tx:${hash}`;
    const rateLimit = new Map();

    function calcWaldoBonus(xrpAmount) {
        if (xrpAmount >= 100) return 1.30; // 30% bonus
        if (xrpAmount >= 90) return 1.22;  // 22% bonus
        if (xrpAmount >= 80) return 1.15;  // 15% bonus
        return 1.0; // No bonus
    }

    async function hasTrustline(wallet, issuer) {
        const acc = await client.request({ command: "account_lines", account: wallet });
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
            URI: xrpl.convertStringToHex("https://waldocoin.live/badge.json"),
            Flags: 8, // Transferable
            TransferFee: 0,
            NFTokenTaxon: 0,
        };
        const prepared = await client.autofill(tx);
        const signed = distributorWallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        // Transfer to user
        const nftID = result.result.meta.CreatedNode?.NewFields?.NFTokens?.[0]?.NFToken?.NFTokenID;
        if (nftID) {
            const transferTx = {
                TransactionType: "NFTokenCreateOffer",
                Account: distributorWallet.classicAddress,
                NFTokenID: nftID,
                Amount: "0",
                Destination: to,
                Flags: 1, // Sell offer
            };
            const preparedTransfer = await client.autofill(transferTx);
            const signedTransfer = distributorWallet.sign(preparedTransfer);
            await client.submitAndWait(signedTransfer.tx_blob);
        }
        return nftID;
    }

    async function processPayment(chatId, userWallet, amount, txHash) {
        const processedKey = processedTxKey(txHash);
        const alreadyProcessed = await redis.get(processedKey);
        if (alreadyProcessed) {
            bot.sendMessage(chatId, "⚠️ This transaction has already been processed.");
            return;
        }

        if (!(await hasTrustline(userWallet, issuer))) {
            bot.sendMessage(chatId, "⚠️ WLO trustline not found. Please set it first:\nhttps://waldocoin.live");
            return;
        }

        const bonus = calcWaldoBonus(amount);
        const waldo = (amount * 100000 * bonus).toFixed(0);

        try {
            const waldoTx = await sendWaldo(userWallet, waldo);
            await redis.set(processedKey, "1", "EX", 86400);

            let confirmationMessage = `✅ Payment confirmed!\n\n💸 Sent: ${amount} XRP\n🎁 WLO: ${waldo}\n📦 TX: https://livenet.xrpl.org/transactions/${waldoTx}`;

            if (NFT_ENABLED) {
                const nftID = await mintNFTBadge(userWallet);
                if (nftID) {
                    confirmationMessage += `\n🏆 NFT Badge: ${nftID.substring(0, 8)}...`;
                }
            }

            bot.sendMessage(chatId, confirmationMessage);
        } catch (error) {
            console.error("Payment processing error:", error);
            bot.sendMessage(chatId, "❌ Error processing payment. Please contact support.");
        }
    }

    // Group message handler
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || "";

        if (msg.chat.type.endsWith("group") && text.includes("https://t.me/WALDOCOINBuyBot")) {
            const markdownMessage = `
📌 *WALDOcoin Presale Bot is Live!*
Buy WLO instantly with XRP — no waiting, no middlemen.

*How it works:*
1️⃣ DM 👉 [@WaldoBuyBot](https://t.me/WALDOCOINBuyBot)
2️⃣ Send your XRPL wallet address
3️⃣ Send XRP to our address
4️⃣ Send XRP → Get WLO instantly (bonus tiers apply!)

*Bonus Tiers:*
• 80 XRP = +15% bonus
• 90 XRP = +22% bonus
• 100 XRP = +30% bonus

*Min: 5 XRP*`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "💸 DM Buy Bot", url: "@WALDOCOINbuyBot" },
                        { text: "🛡️ Set Trustline", url: "https://xrpl.services/?issuer=rnWfL48YCknW6PYewFLKfMKUymHCfj3aww&currency=WLO&limit=100000000" }
                    ],
                    [
                        { text: "🌐 WALDOcoin.live", url: "https://waldocoin.live" },
                        { text: "📣 X (twitter) account", url: "https://x.com/W_A_L_D_O_coin" }
                    ]
                ]
            };

            bot.sendMessage(chatId, markdownMessage, {
                parse_mode: "Markdown",
                reply_markup: keyboard
            });
            return;
        }

        if (msg.chat.type !== "private") return;

        const userId = msg.from.id;
        const now = Date.now();
        const lastMessage = rateLimit.get(userId) || 0;
        if (now - lastMessage < 2000) return;
        rateLimit.set(userId, now);

        if (text.startsWith("/start") || text.includes("start")) {
            const greetedBefore = await redis.get(greetedKey(userId));
            if (!greetedBefore) {
                await redis.set(greetedKey(userId), "1", "EX", 86400);

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

                bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
            }
            return;
        }

        if (text.match(/^r[a-zA-Z0-9]{24,34}$/)) {
            await redis.set(`wallet:${userId}`, text, "EX", 3600);

            const walletMessage = "✅ Wallet received: `" + text + "`\n" +
                "Now send XRP to: `" + distributorWallet.classicAddress + "`\n\n" +
                "I'll check for payment every 60 seconds.";

            bot.sendMessage(chatId, walletMessage, { parse_mode: "Markdown" });

            const checkPayments = async () => {
                try {
                    const transactions = await client.request({
                        command: "account_tx",
                        account: distributorWallet.classicAddress,
                        ledger_index_min: -1,
                        limit: 20
                    });

                    for (const tx of transactions.result.transactions) {
                        if (tx.tx.TransactionType === "Payment" &&
                            tx.tx.Destination === distributorWallet.classicAddress &&
                            typeof tx.tx.Amount === "string") {

                            const amount = parseFloat(tx.tx.Amount) / 1000000;
                            if (amount >= 5) {
                                await processPayment(chatId, text, amount, tx.tx.hash);
                            }
                        }
                    }
                } catch (error) {
                    console.error("Payment check error:", error);
                }
            };

            const interval = setInterval(checkPayments, 60000);
            setTimeout(() => clearInterval(interval), 3600000);
            checkPayments();
        }
    });
}