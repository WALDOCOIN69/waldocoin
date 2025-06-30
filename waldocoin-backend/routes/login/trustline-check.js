// routes/login/trustline-check.js
import express from "express";
import { getXrplClient } from "../../utils/xrplClient.js";

const router = express.Router();

// In-memory cache (DEV ONLY; for production use Redis, etc.)
const trustlineCache = {};

router.get("/", async (req, res) => {
  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: "Missing wallet address" });

  // Use a short cache (5 min)
  if (trustlineCache[wallet] && Date.now() - trustlineCache[wallet].ts < 5 * 60 * 1000) {
    return res.json({ hasWaldoTrustline: trustlineCache[wallet].value });
  }

  try {
    const client = await getXrplClient();
    const response = await client.request({
      command: "account_lines",
      account: wallet,
    });

    const hasWaldoTrustline = response.result.lines.some(
      (line) =>
        line.currency === "WLO" &&
        line.account === "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"
    );

    // Cache it
    trustlineCache[wallet] = { value: hasWaldoTrustline, ts: Date.now() };

    res.json({ hasWaldoTrustline });
  } catch (err) {
    console.error("❌ Trustline check failed:", err.message);
    res.status(500).json({ error: "Trustline check error" });
  }
});

export default router;

