// cron/battleRefunder.js
import { xummClient } from "../utils/xummClient.js";
import fs from "fs";

const battles = JSON.parse(fs.readFileSync(new URL("../data/battles.json", import.meta.url)));

const xumm = getXummClient();
const REFUND_FEE = 0; // Change to 5 for fee

export async function refundExpiredBattles() {
  const now = Date.now();
  let updated = false;

  for (const id in battles) {
    const b = battles[id];

    // ⏩ Skip if not eligible for refund
    if (
      b.status !== "pending" ||
      b.refunded ||
      now - b.startTime <= 10 * 60 * 60 * 1000 // 10 hours
    ) {
      console.log(`⏩ Skipped battle ${id}`);
      continue;
    }

    const refundAmount = b.amount - REFUND_FEE;
    const destination = b.starterWallet;

    try {
      const payload = {
        TransactionType: "Payment",
        Destination: destination,
        Amount: {
          currency: "WLO",
          issuer: process.env.ISSUER_WALLET,
          value: refundAmount.toString(),
        },
      };

      // 🔐 Submit transaction via XUMM
      const { result } = await xumm.payload.submit(payload);

      battles[id].status = "expired";
      battles[id].refunded = true;
      battles[id].refundedAt = now;
      battles[id].refundTx = result?.hash || "manual";

      updated = true;
      console.log(`✅ Refunded ${refundAmount} WALDO to ${destination} for battle ${id}`);
    } catch (err) {
      console.error(`❌ Refund failed for battle ${id}:`, err.message);
      battles[id].refundTx = "error";
    }
  }

  if (updated) {
    fs.writeFileSync("./data/battles.json", JSON.stringify(battles, null, 2));
    console.log("💾 battles.json updated with refund info.");
  }
}

