// WALDO Buy Bot with group detection, DM flow, trustline check, bonuses, auto WALDO sender
import { config } from "dotenv";
config();

import TelegramBot from "node-telegram-bot-api";
import xrpl from "xrpl";
import Redis from "ioredis";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false }); // DISABLED - Using webhooks
const client = new xrpl.Client(process.env.XRPL_ENDPOINT);
const redis = new Redis(process.env.REDIS_URL);

export async function startBuyBot() {
    await client.connect();
    console.log("✅ WALDO Buy Bot connected to XRPL");

    const distributorWallet = xrpl.Wallet.fromSeed(process.env.WALDO_DISTRIBUTOR_SECRET);
    const issuer = process.env.WALDO_ISSUER;
    const NFT_ENABLED = process.env.NFT_BADGE_ENABLED === "true";

    const greetedKey = (id) => `greeted:${id}`;
    const processedTxKey = (hash) => `tx:${hash}`;
    const rateLimit = new Map();

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
                bot.sendMessage(chatId, "⚠️ WLO trustline not found. Please set it first:\nhttps://waldocoin.live");
                continue;
            }

            const waldoTx = await sendWaldo(wallet, waldo);
            let nftTx = null;
            if (NFT_ENABLED) nftTx = await mintNFTBadge(wallet);

            await redis.set(
                hashKey,
                JSON.stringify({ wallet, amount, waldo, waldoTx, nftTx, date: Date.now() })
            );

            // FIXED: Build confirmation message properly
            let confirmationMessage = `✅ Payment confirmed!\n\n💸 Sent: ${amount} XRP\n🎁 WLO: ${waldo}\n📦 TX: https://livenet.xrpl.org/transactions/${waldoTx}`;

            if (nftTx) {
                confirmationMessage += `\n🏅 NFT: https://livenet.xrpl.org/transactions/${nftTx}`;
            }

            bot.sendMessage(chatId, confirmationMessage, { parse_mode: "Markdown" });
        }
    }

    // Group chat trigger
    bot.on("message", (msg) => {
        const chatId = msg.chat.id;
        const text = (msg.text || "").toLowerCase();

        if (msg.chat.type.endsWith("group") && text.includes("@WALDOCOINbuyBot")) {
            const WALDO_ISSUER = process.env.WALDO_ISSUER;

            const markdownMessage = `
📌 *WALDOcoin Presale Bot is Live!*
Buy WLO instantly with XRP — no waiting, no middlemen.

🚀 *How to get started:*
1️⃣ DM 👉 [@WaldoBuyBot](https://t.me/WALDOCOINbuyBot)
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
📣 [Join Telegram](https://t.me/WALDOcoinXRP)
      `;

            bot.sendMessage(chatId, markdownMessage, {
                parse_mode: "Markdown",
                disable_web_page_preview: false,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "💸 DM Buy Bot", url: "https://t.me/WaldoBuyBot" },
                            { text: "🛡️ Set Trustline", url: `https://xrpl.services/?issuer=${WALDO_ISSUER}&currency=WLO&limit=976849999` },
                        ],
                        [
                            { text: "🌐 WALDOcoin.live", url: "https://waldocoin.live" },
                            { text: "📣 Join Telegram", url: "https://t.me/WALDOcoinXRP" },
                        ],
                    ],
                },
            });
            return;
        }

        // DM flow
        const isPrivate = msg.chat.type === "private";
        if (isPrivate) {
            if (rateLimit.has(chatId) && Date.now() - rateLimit.get(chatId) < 3000) return;
            rateLimit.set(chatId, Date.now());

            redis.exists(greetedKey(chatId)).then((exists) => {
                if (!exists) {
                    // FIXED: Build welcome message without problematic backticks
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
                    redis.set(greetedKey(chatId), "1");
                    return;
                }

                if (text.startsWith("r") && text.length >= 25 && text.length <= 35) {
                    // FIXED: Build wallet confirmation message without problematic backticks
                    const walletMessage = "✅ Wallet received: `" + text + "`\n" +
                        "Now send XRP to: `" + distributorWallet.classicAddress + "`\n\n" +
                        "I'll check for payment every 60 seconds.";

                    bot.sendMessage(chatId, walletMessage, { parse_mode: "Markdown" });
                    const interval = setInterval(() => checkIncoming(text, chatId), 60000);
                    setTimeout(() => clearInterval(interval), 1800000);
                } else {
                    bot.sendMessage(chatId, "❌ Invalid XRPL address. Please try again.");
                }
            });
        }
    });
}



