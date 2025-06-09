import express from "express";
import fetch from "node-fetch";
import { patchRouter } from "../utils/patchRouter.js";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
patchRouter(router, path.basename(__filename)); // ✅ catch malformed routes

// 🌐 XRPL Mainnet endpoint
const XRPL_NODE = "https://s1.ripple.com:51234";
const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
const CURRENCY = "WLO";

// ✅ GET /api/trustline-check/check?wallet=rXYZ
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
