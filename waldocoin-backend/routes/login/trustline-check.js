// routes/login/trustline-check.js
import express from "express";
import { getXrplClient } from "../../utils/xrplClient.js"; // adjust if needed

const router = express.Router();

router.get("/", async (req, res) => {
  const { wallet } = req.query;

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet address" });
  }

  try {
    const client = await getXrplClient(); // your existing client wrapper
    const response = await client.request({
      command: "account_lines",
      account: wallet,
    });

    const hasWaldoTrustline = response.result.lines.some(
      (line) =>
        line.currency === "WLO" &&
        line.account === "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"
    );

    res.json({ hasWaldoTrustline });
  } catch (err) {
    console.error("❌ Trustline check failed:", err.message);
    res.status(500).json({ error: "Trustline check error" });
  }
});

export default router;
