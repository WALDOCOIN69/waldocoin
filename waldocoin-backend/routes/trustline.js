import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// 🌐 XRPL Mainnet endpoint
const XRPL_NODE = "https://s1.ripple.com:51234";

// WALDO token info
const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const CURRENCY = "WLO";

// ✅ GET /api/login/trustline-check?wallet=rXYZ
router.get("/check", async (req, res) => {
  const wallet = req.query.wallet;

  if (!wallet) {
    return res.status(400).json({ hasWaldoTrustline: false, error: "Missing wallet parameter." });
  }

  try {
    const response = await fetch(XRPL_NODE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_lines",
        params: [{ account: wallet }]
      })
    });

    const json = await response.json();
    const lines = json?.result?.lines || [];

    const hasWaldoTrustline = lines.some(
      line => line.currency === CURRENCY && line.account === WALDO_ISSUER
    );

    res.json({ hasWaldoTrustline });
  } catch (err) {
    console.error("❌ Trustline check failed:", err.message);
    res.status(500).json({ hasWaldoTrustline: false, error: "Trustline check failed." });
  }
});

export default router;

