// routes/xrpl/trade.js
import express from "express";
import { xummClient } from "../../utils/xummClient.js";
import getWaldoPerXrp from "../../utils/getWaldoPerXrp.js";
import xrpl from "xrpl";

const router = express.Router();

// POST /api/xrpl/trade/offer
// Body: { side: "buy"|"sell", amountWlo?: number, amountXrp?: number, slippageBps?: number, destination?: string }
router.post("/offer", async (req, res) => {
  try {
    const { side, amountWlo, amountXrp, slippageBps, destination } = req.body || {};
    if (!side || !["buy", "sell"].includes(side)) {
      return res.status(400).json({ success: false, error: "side must be 'buy' or 'sell'" });
    }
    const DEST = (typeof destination === 'string' && destination.startsWith('r')) ? destination : undefined;
    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";

    const waldoPerXrpRaw = await getWaldoPerXrp().catch(() => null);
    // Prefer XRPL order book mid; if unavailable, fall back to Magnetic (if configured), else tiny default
    async function getXrpPerWloFromBooks() {
      const client = new xrpl.Client("wss://xrplcluster.com");
      await client.connect();
      const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
      const CURRENCY = process.env.WALDOCOIN_TOKEN || "WLO";
      const a = await client.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: { currency: CURRENCY, issuer: ISSUER }, limit: 5 });
      const b = await client.request({ command: 'book_offers', taker_gets: { currency: CURRENCY, issuer: ISSUER }, taker_pays: { currency: 'XRP' }, limit: 5 });
      await client.disconnect();
      let ask = null, bid = null;
      if (a.result?.offers?.length) { const o = a.result.offers[0]; const px = (Number(o.TakerGets) / 1_000_000) / Number(o.TakerPays.value); if (px > 0 && isFinite(px)) ask = px; }
      if (b.result?.offers?.length) { const o = b.result.offers[0]; const px = (Number(o.TakerPays) / 1_000_000) / Number(o.TakerGets.value); if (px > 0 && isFinite(px)) bid = px; }
      return (bid && ask) ? (bid + ask) / 2 : (bid || ask || null);
    }
    const bookMid = await getXrpPerWloFromBooks().catch(() => null);
    const baseMid = (bookMid && isFinite(bookMid)) ? bookMid : ((waldoPerXrpRaw && isFinite(waldoPerXrpRaw)) ? (1 / waldoPerXrpRaw) : 0.00001); // XRP per WLO

    // Optional price adjustments (raise price) via env
    const multRaw = process.env.PRICE_MULTIPLIER_XRP_PER_WLO;
    const floorRaw = process.env.PRICE_FLOOR_XRP_PER_WLO;
    const multiplier = Number(multRaw);
    const floor = Number(floorRaw);
    let mid = baseMid;
    if (isFinite(multiplier) && multiplier > 0) mid = mid * multiplier;
    if (isFinite(floor) && floor > 0) mid = Math.max(mid, floor);

    const bps = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0;
    const slip = Math.max(0, bps) / 10_000; // 0.01 = 1%

    // Payment via paths to use AMM LP + order book
    let txjson;
    if (side === "buy") {
      const xrp = Number(amountXrp);
      if (!Number.isFinite(xrp) || xrp <= 0) return res.status(400).json({ success: false, error: "amountXrp required for buy" });
      const pMax = mid * (1 + slip); // max XRP per WLO
      const deliverMinWlo = xrp / pMax; // minimum WLO to receive after slippage
      txjson = {
        TransactionType: "Payment",
        Destination: DEST, // signer self-payment unless destination provided
        Amount: { currency: CURRENCY, issuer: ISSUER, value: String((xrp / mid).toFixed(6)) },
        DeliverMin: { currency: CURRENCY, issuer: ISSUER, value: String(deliverMinWlo.toFixed(6)) },
        SendMax: String(Math.round(xrp * 1_000_000)), // drops
        Flags: 0x00020000, // tfPartialPayment
      };
    } else {
      const wlo = Number(amountWlo);
      if (!Number.isFinite(wlo) || wlo <= 0) return res.status(400).json({ success: false, error: "amountWlo required for sell" });
      const pMin = mid * (1 - slip); // min XRP per WLO to accept
      const deliverMinXrp = wlo * pMin; // minimum XRP to receive
      txjson = {
        TransactionType: "Payment",
        Destination: DEST, // signer self-payment unless destination provided
        Amount: String(Math.round((wlo * mid) * 1_000_000)), // target XRP (drops)
        DeliverMin: String(Math.round(deliverMinXrp * 1_000_000)), // min XRP (drops)
        SendMax: { currency: CURRENCY, issuer: ISSUER, value: String(wlo.toFixed(6)) },
        Flags: 0x00020000, // tfPartialPayment
      };
    }

    const created = await xummClient.payload.create({
      txjson,
      options: { submit: true, expire: 300, return_url: { app: 'xumm://xumm.app/done', web: null } },
      custom_meta: { identifier: `WALDO_TRADE_${side.toUpperCase()}`, instruction: 'Sign in Xaman and stay in the app' }
    });

    return res.json({ success: true, uuid: created.uuid, refs: created.refs, next: created.next });
  } catch (err) {
    console.error("❌ Trade offer error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

