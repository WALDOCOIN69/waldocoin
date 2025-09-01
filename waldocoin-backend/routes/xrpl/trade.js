// routes/xrpl/trade.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";
import getWaldoPerXrp from "../../utils/getWaldoPerXrp.js";

const router = express.Router();

// POST /api/xrpl/trade/offer
// Body: { side: "buy"|"sell", amountWlo?: number, amountXrp?: number, slippageBps?: number }
router.post("/offer", async (req, res) => {
  try {
    const { side, amountWlo, amountXrp, slippageBps } = req.body || {};
    if (!side || !["buy", "sell"].includes(side)) {
      return res.status(400).json({ success: false, error: "side must be 'buy' or 'sell'" });
    }
    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";

    const waldoPerXrp = await getWaldoPerXrp();
    const mid = waldoPerXrp > 0 ? 1 / waldoPerXrp : 0.00001; // XRP per WLO
    const bps = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0;
    const slip = Math.max(0, bps) / 10_000; // 0.01 = 1%

    let takerGets, takerPays; // OfferCreate semantics

    if (side === "buy") {
      const xrp = Number(amountXrp);
      if (!Number.isFinite(xrp) || xrp <= 0) return res.status(400).json({ success: false, error: "amountXrp required for buy" });
      const pMax = mid * (1 + slip); // max XRP per WLO we're willing to pay
      const minWlo = xrp / pMax; // ensure price <= pMax
      takerPays = String(Math.round(xrp * 1_000_000)); // we pay this many drops
      takerGets = { currency: CURRENCY, issuer: ISSUER, value: String(minWlo.toFixed(6)) }; // we want at least this WLO
    } else {
      const wlo = Number(amountWlo);
      if (!Number.isFinite(wlo) || wlo <= 0) return res.status(400).json({ success: false, error: "amountWlo required for sell" });
      const pMin = mid * (1 - slip); // min XRP per WLO we'll accept
      const minXrp = wlo * pMin;
      takerPays = { currency: CURRENCY, issuer: ISSUER, value: String(wlo.toFixed(6)) }; // we sell this WLO
      takerGets = String(Math.round(minXrp * 1_000_000)); // we require at least this many drops
    }

    const flagsIOC = 0x00020000; // tfImmediateOrCancel

    const txjson = {
      TransactionType: "OfferCreate",
      TakerGets: takerGets,
      TakerPays: takerPays,
      Flags: flagsIOC
    };

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 300, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: `WALDO_TRADE_${side.toUpperCase()}`, instruction: 'Sign in XUMM and return to the app' }
    });

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (err) {
    console.error("❌ Trade offer error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

