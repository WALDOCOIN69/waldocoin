// routes/xrpl/trustline.js
import express from "express";
import xrpl from "xrpl";
import { xummClient } from "../../utils/xummClient.js";

const router = express.Router();

// GET /api/xrpl/trustline/status?account=r...
router.get("/status", async (req, res) => {
  const { account } = req.query;
  if (!account || typeof account !== "string") {
    return res.status(400).json({ success: false, error: "account is required" });
  }
  const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
  const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || "WLO").toUpperCase();

  try {
    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();
    const resp = await client.request({
      command: "account_lines",
      account,
      ledger_index: 'validated',
      limit: 400,
    });
    await client.disconnect();

    const lines = resp?.result?.lines || [];
    const has = lines.some((l) => {
      const cur = String(l.currency || '').trim().toUpperCase();
      const counterparty = l.account || l.issuer || l.counterparty || '';
      return cur === CURRENCY && counterparty === ISSUER;
    });

    return res.json({ success: true, account, issuer: ISSUER, currency: CURRENCY, trustline: has });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/xrpl/trustline/create - Create a Xaman TrustSet payload
router.post("/create", async (req, res) => {
  try {
    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = (process.env.WALDO_CURRENCY || process.env.WALDOCOIN_TOKEN || "WLO").toUpperCase();
    const limit = String(req.body?.limit || "1000000000"); // default: 1,000,000,000 WLO

    const txjson = {
      TransactionType: "TrustSet",
      LimitAmount: { currency: CURRENCY, issuer: ISSUER, value: limit },
      // Flags: 0 // optionally set tfSetNoRipple if you want, but default Xaman UX is fine
    };

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 600, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: "WALDO_TRUSTLINE", instruction: "Add WALDO Trustline and stay in Xaman" }
    });

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

export default router;

