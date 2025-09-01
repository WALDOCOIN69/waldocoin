// routes/xrpl/trade.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";

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

    // Convert inputs to a single target: buy using amountXrp (preferred) or amountWlo; sell using amountWlo (preferred)
    let takerGets, takerPays; // OfferCreate semantics
    if (side === "buy") {
      const xrp = Number(amountXrp);
      if (!Number.isFinite(xrp) || xrp <= 0) return res.status(400).json({ success: false, error: "amountXrp required for buy" });
      takerGets = String(Math.round(xrp * 1_000_000)); // drops
      // TakerPays: max WLO we are willing to spend vs price; since we IOC, we'll set a high cap
      const wloCap = Number.isFinite(amountWlo) && amountWlo > 0 ? amountWlo : xrp * 20000; // generous cap
      takerPays = { currency: CURRENCY, issuer: ISSUER, value: String(wloCap.toFixed(6)) };
    } else {
      const wlo = Number(amountWlo);
      if (!Number.isFinite(wlo) || wlo <= 0) return res.status(400).json({ success: false, error: "amountWlo required for sell" });
      takerPays = { currency: CURRENCY, issuer: ISSUER, value: String(wlo.toFixed(6)) };
      // Receive XRP estimate; we use DeliverMin for slippage guard if provided
      const xrpCap = Number.isFinite(amountXrp) && amountXrp > 0 ? amountXrp : wlo * 0.00001; // rough default
      takerGets = String(Math.round(xrpCap * 1_000_000));
    }

    const flagsIOC = 0x00020000; // tfImmediateOrCancel

    const txjson = {
      TransactionType: "OfferCreate",
      TakerGets: takerGets,
      TakerPays: takerPays,
      Flags: flagsIOC
    };

    // Optional DeliverMin for sells (protect against bad fills)
    if (side === "sell" && Number.isFinite(slippageBps) && slippageBps > 0) {
      const minXrp = Math.max(0, Number(amountXrp || 0) * (1 - slippageBps / 10_000));
      if (minXrp > 0) txjson.DeliverMin = String(Math.round(minXrp * 1_000_000));
    }

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 300 },
      custom_meta: { identifier: `WALDO_TRADE_${side.toUpperCase()}` }
    });

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (err) {
    console.error("❌ Trade offer error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

