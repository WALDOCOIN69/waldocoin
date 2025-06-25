// 📁 routes/presale.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js";
import { getXrplClient } from "../utils/xrplClient.js";
import { WALDO_TREASURY } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 📦 POST /verify — Verify TX and log WALDO purchase
router.post("/verify", async (req, res) => {
  const { txId, email } = req.body;
  if (!txId) return res.status(400).json({ success: false, error: "Missing transaction ID." });

  try {
    const client = await getXrplClient();
    const result = await client.request({ command: "tx", transaction: txId });
    const tx = result.result;

    if (tx.TransactionType !== "Payment") {
      return res.status(400).json({ success: false, error: "Not an XRP payment." });
    }

    const destination = tx.Destination;
    const amount = parseInt(tx.Amount, 10);
    const sender = tx.Account;
    const timestamp = Date.now();

    if (destination !== WALDO_TREASURY) {
      return res.status(400).json({ success: false, error: "Wrong destination address." });
    }

    if (amount % 10000000 !== 0) {
      return res.status(400).json({ success: false, error: "Amount must be a multiple of 10 XRP." });
    }

    const xrp = amount / 1000000;
    const base = xrp * 100000;
    let bonus = 0;
    if (xrp === 80) bonus = 2000000;
    else if (xrp === 90) bonus = 3000000;
    else if (xrp === 100) bonus = 5000000;
    const total = base + bonus;

    const duplicate = await redis.get(`presale:tx:${txId}`);
    if (duplicate) {
      return res.status(400).json({ success: false, error: "TX already submitted." });
    }

    await redis.set(`presale:tx:${txId}`, "1");
    await redis.set(`presale:wallet:${sender}`, JSON.stringify({
      wallet: sender,
      amount: xrp,
      tokens: total,
      email: email || null,
      timestamp
    }));
    await redis.rpush("presale:feed", JSON.stringify({
      wallet: sender,
      tokens: total,
      timestamp
    }));
    await redis.incrby("presale:total", total);

    logPresalePurchase(sender, xrp, total, bonus ? (bonus / base) * 100 : 0);
    res.json({ success: true, tokens: total });

  } catch (err) {
    console.error("❌ TX verify failed:", err);
    res.status(500).json({ success: false, error: "Verification error" });
  }
});

// 🔍 GET /lookup?wallet=rXXXX — Lookup presale by wallet
router.get("/lookup", async (req, res) => {
  const { wallet } = req.query;
  if (!wallet || !wallet.startsWith("r")) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  const data = await redis.get(`presale:wallet:${wallet}`);
  if (!data) return res.status(404).json({ error: "No presale record found." });

  res.json(JSON.parse(data));
});

// 📰 GET /feed — Recent presale buyers
router.get("/feed", async (req, res) => {
  const raw = await redis.lrange("presale:feed", -10, -1);
  const feed = raw.map(item => JSON.parse(item)).reverse();
  res.json(feed);
});

// 💰 GET /total-sold — WALDO total sold
router.get("/total-sold", async (req, res) => {
  const total = await redis.get("presale:total");
  res.json({ sold: parseInt(total || "0", 10) });
});

// 🗓️ GET /end-date — Get presale end date
router.get("/end-date", async (req, res) => {
  try {
    const storedDate = await redis.get("presaleEndDate");
    return res.json({ endDate: storedDate || null });
  } catch (err) {
    console.error("❌ Error fetching end date:", err);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// 🗓️ POST /end-date — Set presale end date
router.post("/end-date", async (req, res) => {
  const { endDate } = req.body;
  if (!endDate) return res.status(400).json({ success: false, error: "Missing endDate" });

  try {
    await redis.set("presaleEndDate", endDate);
    console.log(`✅ Presale end date updated: ${endDate}`);
    return res.json({ success: true, endDate });
  } catch (err) {
    console.error("❌ Error setting end date:", err);
    return res.status(500).json({ success: false, error: "Failed to update" });
  }
});

// 🧾 Log presale to console
export function logPresalePurchase(wallet, xrpAmount, waldoAmount, bonusPercent) {
  console.log(`🧾 PRESALE LOG: ${wallet} sent ${xrpAmount} XRP → ${waldoAmount} WALDO (Bonus: ${bonusPercent}%)`);
}

export default router;
