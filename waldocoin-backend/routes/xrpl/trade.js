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

    // Optional price adjustments (raise price) via env or Redis (handled in bot/market too)
    const multRaw = process.env.PRICE_MULTIPLIER_XRP_PER_WLO;
    const floorRaw = process.env.PRICE_FLOOR_XRP_PER_WLO;
    const multiplier = Number(multRaw);
    const floor = Number(floorRaw);
    let mid = baseMid;
    if (isFinite(multiplier) && multiplier > 0) mid = mid * multiplier;
    if (isFinite(floor) && floor > 0) mid = Math.max(mid, floor);

    const bps = Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0;
    const slip = Math.max(0, bps) / 10_000; // 0.01 = 1%

    // Optional default destination for SELL payouts (e.g., treasury)
    const DEFAULT_DEST = process.env.SWAP_DESTINATION || process.env.SWAP_PAYOUT_DESTINATION;

    // Payment via paths to use AMM LP + order book
    let txjson;
    if (side === "buy") {
      const xrp = Number(amountXrp);
      if (!Number.isFinite(xrp) || xrp <= 0) return res.status(400).json({ success: false, error: "amountXrp required for buy" });

      // For buy: Create a simple XRP to WLO payment
      // Use the distributor as destination to handle the swap
      const distributorWallet = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET;
      txjson = {
        TransactionType: "Payment",
        Destination: distributorWallet,
        Amount: String(Math.round(xrp * 1_000_000)), // XRP in drops
        Memos: [{
          Memo: {
            MemoType: Buffer.from('WALDO_BUY').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Buy ${(xrp / mid).toFixed(6)} WLO for ${xrp} XRP`).toString('hex').toUpperCase()
          }
        }]
      };
    } else {
      const wlo = Number(amountWlo);
      if (!Number.isFinite(wlo) || wlo <= 0) return res.status(400).json({ success: false, error: "amountWlo required for sell" });

      // For sell: Create a simple WLO to distributor payment
      // The distributor will handle sending XRP back
      const distributorWallet = process.env.WALDO_DISTRIBUTOR_WALLET || process.env.DISTRIBUTOR_WALLET;
      txjson = {
        TransactionType: "Payment",
        Destination: distributorWallet,
        Amount: { currency: CURRENCY, issuer: ISSUER, value: String(wlo.toFixed(6)) },
        Memos: [{
          Memo: {
            MemoType: Buffer.from('WALDO_SELL').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Sell ${wlo} WLO for ${(wlo * mid).toFixed(6)} XRP`).toString('hex').toUpperCase()
          }
        }]
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

