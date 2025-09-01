// routes/market/wlo.js
import express from "express";
import xrpl from "xrpl";
import { redis } from "../../redisClient.js";
import getWaldoPerXrp from "../../utils/getWaldoPerXrp.js";

const router = express.Router();

// GET /api/market/wlo - top-of-book + Magnetic-derived rate
router.get("/", async (_req, res) => {
  const result = {
    success: true,
    source: { price: "xrpl+magnetic", volume: "redis|unknown" },
    waldoPerXrp: null,
    xrpPerWlo: null,
    best: { bid: null, ask: null, mid: null },
    volume24h: null,
    timestamp: new Date().toISOString(),
  };

  try {
    // Magnetic-derived rate (cached)
    const waldoPerXrp = await getWaldoPerXrp();
    result.waldoPerXrp = waldoPerXrp;
    result.xrpPerWlo = waldoPerXrp > 0 ? 1 / waldoPerXrp : null;
  } catch (e) {
    // ignore; keep null
  }

  try {
    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();

    const ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = "WLO";

    // Ask: people selling WLO for XRP (WLO->XRP book)
    const wloToXrp = await client.request({
      command: "book_offers",
      taker_gets: { currency: "XRP" }, // taker receives XRP
      taker_pays: { currency: CURRENCY, issuer: ISSUER }, // taker pays WLO
      limit: 10,
    });

    let askPrice = null; // XRP per WLO (best ask)
    if (wloToXrp.result?.offers?.length) {
      const best = wloToXrp.result.offers[0];
      if (best.quality) {
        // quality here is WLO per 1 XRP → invert to XRP per WLO
        const qp = parseFloat(best.quality);
        if (qp > 0 && isFinite(qp)) askPrice = 1 / qp;
      } else {
        // fallback: XRP/WLO = (TakerGets XRP drops / 1e6) / (TakerPays WLO)
        const getsXrp = parseFloat(best.TakerGets) / 1_000_000;
        const paysWlo = parseFloat(best.TakerPays.value);
        const p = getsXrp / paysWlo;
        if (p > 0 && isFinite(p)) askPrice = p;
      }
    }

    // Bid: people buying WLO with XRP (XRP->WLO book)
    const xrpToWlo = await client.request({
      command: "book_offers",
      taker_gets: { currency: CURRENCY, issuer: ISSUER }, // taker receives WLO
      taker_pays: { currency: "XRP" }, // taker pays XRP
      limit: 10,
    });

    let bidPrice = null; // XRP per WLO (best bid)
    if (xrpToWlo.result?.offers?.length) {
      const best = xrpToWlo.result.offers[0];
      if (best.quality) {
        // quality here is XRP per 1 WLO directly (for this book)
        const qp = parseFloat(best.quality);
        if (qp > 0 && isFinite(qp)) bidPrice = qp;
      } else {
        // fallback: XRP/WLO = (TakerPays XRP drops / 1e6) / (TakerGets WLO)
        const paysXrp = parseFloat(best.TakerPays) / 1_000_000;
        const getsWlo = parseFloat(best.TakerGets.value);
        const p = paysXrp / getsWlo;
        if (p > 0 && isFinite(p)) bidPrice = p;
      }
    }

    await client.disconnect();

    const mid = bidPrice && askPrice ? (bidPrice + askPrice) / 2 : (bidPrice || askPrice || null);
    result.best = { bid: bidPrice, ask: askPrice, mid };
  } catch (e) {
    // XRPL query failed; keep best.* null
  }

  try {
    // Try 24h volume from Redis (if maintained by bot or analytics)
    const vol = await redis.get("market:volume24h");
    const botVol = await redis.get("volume_bot:volume_24h");
    const v = vol || botVol;
    if (v) result.volume24h = isNaN(Number(v)) ? v : Number(v);
  } catch (e) { }

  return res.json(result);
});

export default router;

