// routes/presaleVerify.js
import express from "express";
import { getXummClient } from "../utils/xummClient.js";
import { Client } from "xrpl";
import { redis } from "../../redisClient.js"; // <-- FIXED
import { WALDO_ISSUER, WALDO_TOKEN, WALDO_DISTRIBUTOR } from "../config.js";

const router = express.Router();
const xrplClient = new Client("wss://xrplcluster.com");

const WALDO_PER_XRP = 1000;

router.post("/", async (req, res) => {
  const { txId, email } = req.body;
  if (!txId) return res.json({ success: false, error: "Missing transaction ID." });

  try {
    await xrplClient.connect();
    const tx = await xrplClient.request({ command: "tx", transaction: txId });

    const txData = tx.result;
    if (txData.TransactionType !== "Payment" || txData.meta.TransactionResult !== "tesSUCCESS") {
      return res.json({ success: false, error: "Invalid or failed XRP payment." });
    }

    // Already processed?
    const alreadyProcessed = await redis.get(`presale:tx:${txId}`);
    if (alreadyProcessed) return res.json({ success: false, error: "Transaction already used." });

    // Confirm it was to our WALDO distributor
    if (txData.Destination !== WALDO_DISTRIBUTOR) {
      return res.json({ success: false, error: "Incorrect destination address." });
    }

    const sender = txData.Account;
    const amountXRP = parseFloat(txData.Amount) / 1_000_000;

    // Validate min
    if (amountXRP < 5 || amountXRP > 100 || amountXRP % 5 !== 0) {
      return res.json({ success: false, error: "Amount must be in 5 XRP increments (5–100)." });
    }

    // Bonus logic (updated for 1k base rate)
    let bonus = 0;
    if (amountXRP === 80) bonus = 12_000; // 15% bonus
    if (amountXRP === 90) bonus = 20_000; // 22% bonus
    if (amountXRP === 100) bonus = 30_000; // 30% bonus

    const totalWaldo = amountXRP * WALDO_PER_XRP + bonus;

    // Trustline check
    const acctLines = await xrplClient.request({ command: "account_lines", account: sender });
    const hasTrust = acctLines.result.lines.some(
      l => l.currency === WALDO_TOKEN && l.issuer === WALDO_ISSUER
    );

    if (!hasTrust) {
      return res.json({ success: false, error: "No WALDO trustline found. Please add it first." });
    }

    // Send WALDO
    const xumm = getXummClient();
    const txPayload = {
      txjson: {
        TransactionType: "Payment",
        Account: WALDO_DISTRIBUTOR,
        Destination: sender,
        Amount: {
          currency: WALDO_TOKEN,
          issuer: WALDO_ISSUER,
          value: totalWaldo.toString()
        }
      }
    };

    const payload = await xumm.payload.createAndSubscribe(txPayload, event => {
      if (event.data.signed === true) {
        return event;
      }
    });

    // Save TX to Redis
    await redis.set(`presale:tx:${txId}`, "sent");
    await redis.set(`presale:wallet:${sender}`, JSON.stringify({
      wallet: sender,
      amount: amountXRP,
      tokens: totalWaldo,
      email: email || null,
      timestamp: Date.now(),
      bonusTier: bonus > 0 ? `${bonus.toLocaleString()} Bonus` : null
    }));

    res.json({ success: true, tokens: totalWaldo });

  } catch (err) {
    console.error("Verification error:", err);
    res.json({ success: false, error: "Error verifying transaction." });
  } finally {
    xrplClient.disconnect();
  }
});

export default router;
