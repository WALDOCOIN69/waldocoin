// cron/battleRefunder.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { xummClient } from "../utils/xummClient.js";
import { WALDO_ISSUER, WALDOCOIN_TOKEN, WALDO_DISTRIBUTOR_SECRET } from "../config.js";
import { Client, Wallet, convertStringToHex } from "xrpl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const battlesPath = path.join(__dirname, "../data/battles.json");

// 🔁 Load and parse battles
function loadBattles() {
  try {
    const data = fs.readFileSync(battlesPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ Failed to load battles.json:", err.message);
    return [];
  }
}

// 💾 Save updated battle list
function saveBattles(battles) {
  fs.writeFileSync(battlesPath, JSON.stringify(battles, null, 2));
}

// 🚨 Refund unaccepted expired battles (10hr window)
async function refundExpiredBattles() {
  const battles = loadBattles();
  if (!Array.isArray(battles)) {
  console.warn("⚠️ battles.json invalid, resetting to []");
  saveBattles([]);
  return;
}

  const now = Date.now();
  let changed = false;

  for (const battle of battles) {
    if (
      battle.status === "pending" &&
      now - new Date(battle.createdAt).getTime() > 10 * 60 * 60 * 1000 // 10 hours
    ) {
      console.log(`🔄 Refunding unaccepted battle: ${battle.id}`);

      const client = new Client("wss://s.altnet.rippletest.net:51233"); // XRPL testnet
      const wallet = Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
      await client.connect();

      const tx = {
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: battle.challenger,
        Amount: {
          currency: WALDOCOIN_TOKEN,
          issuer: WALDO_ISSUER,
          value: "100"
        },
        Memos: [
          {
            Memo: {
              MemoType: convertStringToHex("WALDO Refund"),
              MemoData: convertStringToHex(`Refund for unaccepted battle: ${battle.id}`)
            }
          }
        ]
      };

      const prepared = await client.autofill(tx);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);
      await client.disconnect();

      if (result.result.meta.TransactionResult === "tesSUCCESS") {
        console.log(`✅ Refund sent to ${battle.challenger}`);
        battle.status = "refunded";
        battle.refundedAt = new Date().toISOString();
        changed = true;
      } else {
        console.error(`❌ Refund failed:`, result.result.meta.TransactionResult);
      }
    }
  }

  if (changed) saveBattles(battles);
}

// 🔁 CLI mode
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refundExpiredBattles().catch((err) => {
    console.error("❌ Refund error:", err.message);
  });
}

export { refundExpiredBattles };

