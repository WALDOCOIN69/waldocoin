// routes/presaleLookup.js
import express from "express";
import { redis } from "../redisClient.js";

const router = express.Router();

// Admin key to reveal email addresses (optional, configured via environment)
const ADMIN_KEY = process.env.X_ADMIN_KEY || process.env.ADMIN_KEY || null;

// Helper: format timestamp
function formatDate(ms) {
  const d = new Date(parseInt(ms));
  const pad = n => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * GET /api/presale/lookup?wallet=r...
 * Returns all matching presale transactions for a given wallet
 */
router.get("/lookup", async (req, res) => {
  const wallet = req.query.wallet;
  const isAdmin = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;

  if (!wallet || !wallet.startsWith("r")) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  try {
    const raw = await redis.get("presale:buyers");
    const buyers = raw ? JSON.parse(raw) : [];

    const matches = buyers
      .filter(b => b.wallet === wallet)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(tx => ({
        wallet: tx.wallet,
        amount: tx.amount,
        tokens: tx.tokens,
        bonusTier: tx.bonusTier || null,
        email: isAdmin ? (tx.email || null) : (tx.email ? "🔒 hidden" : null),
        timestamp: tx.timestamp || null,
        dateFormatted: tx.timestamp ? formatDate(tx.timestamp) : null
      }));

    if (!matches.length) {
      return res.status(404).json({ error: "No presale transactions found for this wallet." });
    }

    res.json({ wallet, count: matches.length, transactions: matches });

  } catch (err) {
    console.error("❌ Redis lookup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


