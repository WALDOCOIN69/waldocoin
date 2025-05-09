import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const XRPL_NODE = "https://s1.ripple.com:51234"; // Mainnet
const WALDO_ISSUER = "rf97bQQbqztUnL1BYB5ti4rC691e7u5C8F"; // Your WALDO issuer address
const CURRENCY = "WLO";

// POST /api/trustline/check
router.post("/check", async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) {
    return res.status(400).json({ success: false, error: "Missing wallet address." });
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

    const hasTrustline = lines.some(
      line => line.currency === CURRENCY && line.account === WALDO_ISSUER
    );

    res.json({ success: true, wallet, trustline: hasTrustline });
  } catch (err) {
    console.error("Trustline check failed:", err.message);
    res.status(500).json({ success: false, error: "Trustline check failed." });
  }
});

export default router;
