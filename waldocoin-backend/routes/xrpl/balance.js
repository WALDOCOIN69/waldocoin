import express from "express";
import xrpl from "xrpl";
import { getXrplClient } from "../../utils/xrplClient.js";

const router = express.Router();

// GET /api/xrpl/balance?account=r...
router.get("/", async (req, res) => {
  try {
    const account = String(req.query.account || "").trim();
    if (!account || account.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid or missing account" });
    }

    const client = await getXrplClient();

    // XRP balance
    let xrp = 0;
    try {
      const info = await client.request({ command: "account_info", account, ledger_index: "validated" });
      xrp = parseFloat(xrpl.dropsToXrp(info?.result?.account_data?.Balance || "0"));
    } catch (_) { /* leave as 0 */ }

    // WALDO balance via trust line
    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || "WLO").toUpperCase();
    let waldo = 0;
    try {
      const lines = await client.request({ command: "account_lines", account, ledger_index: "validated", limit: 400 });
      const line = (lines?.result?.lines || []).find(l => String(l.currency || '').toUpperCase() === CURRENCY && (l.account === ISSUER || l.issuer === ISSUER || l.counterparty === ISSUER));
      if (line && line.balance != null) {
        waldo = parseFloat(line.balance) || 0;
      }
    } catch (_) { /* leave as 0 */ }

    return res.json({ success: true, account, xrp, waldo });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

