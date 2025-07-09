// cron/battleRefunder.js
import { redis } from "../redisClient.js";
import { WALDO_ISSUER, WALDOCOIN_TOKEN, WALDO_DISTRIBUTOR_SECRET } from "../constants.js";
import { Client, Wallet, convertStringToHex } from "xrpl";

// 10 hours in ms
const BATTLE_REFUND_WINDOW = 10 * 60 * 60 * 1000;

async function refundExpiredBattles() {
  // Scan for all keys matching pattern (could be improved for large sets)
  const keys = await redis.keys("battle:*:data");
  const now = Date.now();

  for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data || data.status !== "pending" || !data.createdAt) continue;

    const createdAt = Number(data.createdAt);
    if (now - createdAt > BATTLE_REFUND_WINDOW) {
      console.log(`🔄 Refunding unaccepted battle: ${key}`);
      // Send refund to challenger
      const client = new Client("wss://xrplcluster.com");
      const wallet = Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
      await client.connect();

      const tx = {
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: data.challenger,
        Amount: {
          currency: WALDOCOIN_TOKEN,
          issuer: WALDO_ISSUER,
          value: "100"
        },
        Memos: [
          {
            Memo: {
              MemoType: convertStringToHex("WALDO Refund"),
              MemoData: convertStringToHex(`Refund for unaccepted battle: ${key}`)
            }
          }
        ]
      };

      const prepared = await client.autofill(tx);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);
      await client.disconnect();

      if (result.result.meta.TransactionResult === "tesSUCCESS") {
        console.log(`✅ Refund sent to ${data.challenger}`);
        await redis.hset(key, {
          status: "refunded",
          refundedAt: Date.now()
        });
      } else {
        console.error(`❌ Refund failed:`, result.result.meta.TransactionResult);
      }
    }
  }
}

// Standalone run (CLI/cron mode)
if (process.argv[1] === (new URL(import.meta.url)).pathname) {
  refundExpiredBattles().catch((err) => {
    console.error("❌ Refund error:", err.message);
  });
}

export { refundExpiredBattles };

