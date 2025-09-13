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
    source: { price: "xrpl+magnetic", volume: "redis|unknown", magnetic: Boolean(process.env.MAGNETIC_PRICE_URL) },
    waldoPerXrp: null,
    xrpPerWlo: null,
    best: { bid: null, ask: null, mid: null },
    volume24h: null,
    timestamp: new Date().toISOString(),
  };

  try {
    // Magnetic-derived rate (cached). Only expose if Magnetic is configured.
    if (process.env.MAGNETIC_PRICE_URL) {
      const waldoPerXrp = await getWaldoPerXrp();
      // Treat default presale fallback (10000) as "not available" so we can fall back to XRPL mid
      if (typeof waldoPerXrp === 'number' && isFinite(waldoPerXrp) && waldoPerXrp > 0 && waldoPerXrp !== 10000) {
        result.waldoPerXrp = waldoPerXrp;
        result.xrpPerWlo = 1 / waldoPerXrp;
      }
    }
  } catch (e) {
    // ignore; keep null
  }

  try {
    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();

    const ISSUER = process.env.WALDO_ISSUER || "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY";
    const CURRENCY = (process.env.WALDO_CURRENCY || "WLO").toUpperCase();

    // Ask: people selling WLO for XRP (WLO->XRP book)
    const wloToXrp = await client.request({
      command: "book_offers",
      taker_gets: { currency: "XRP" }, // taker receives XRP (drops)
      taker_pays: { currency: CURRENCY, issuer: ISSUER }, // taker pays WLO (issued)
      limit: 10,
    });

    let askPrice = null; // XRP per WLO (best ask)
    if (wloToXrp.result?.offers?.length) {
      const best = wloToXrp.result.offers[0];
      // Compute strictly from amounts to avoid quality interpretation surprises
      const getsXrp = Number(best.TakerGets) / 1_000_000; // drops -> XRP
      const paysWlo = Number(best.TakerPays?.value);
      const p = getsXrp > 0 && paysWlo > 0 ? (getsXrp / paysWlo) : null;
      if (p && isFinite(p) && p > 0) askPrice = p;
    }

    // Bid: people buying WLO with XRP (XRP->WLO book)
    const xrpToWlo = await client.request({
      command: "book_offers",
      taker_gets: { currency: CURRENCY, issuer: ISSUER }, // taker receives WLO (issued)
      taker_pays: { currency: "XRP" }, // taker pays XRP (drops)
      limit: 10,
    });

    let bidPrice = null; // XRP per WLO (best bid)
    if (xrpToWlo.result?.offers?.length) {
      const best = xrpToWlo.result.offers[0];
      const paysXrp = Number(best.TakerPays) / 1_000_000; // drops -> XRP
      const getsWlo = Number(best.TakerGets?.value);
      const p = paysXrp > 0 && getsWlo > 0 ? (paysXrp / getsWlo) : null;
      if (p && isFinite(p) && p > 0) bidPrice = p;
    }

    await client.disconnect();

    const mid = bidPrice && askPrice ? (bidPrice + askPrice) / 2 : (bidPrice || askPrice || null);
    result.best = { bid: bidPrice, ask: askPrice, mid };
    // Choose display price: prefer Magnetic if available, otherwise XRPL mid
    let baseXrpPerWlo = null;
    if (typeof result.waldoPerXrp === 'number' && isFinite(result.waldoPerXrp) && result.waldoPerXrp > 0) {
      baseXrpPerWlo = 1 / result.waldoPerXrp;
      result.source.used = 'magnetic';
    } else if (mid && isFinite(mid)) {
      baseXrpPerWlo = mid;
      result.source.used = 'xrpl';
      result.waldoPerXrp = 1 / mid;
    }
    result.xrpPerWlo = baseXrpPerWlo;
  } catch (e) {
    // XRPL query failed; keep best.* null
  }

  // Apply optional price adjustments controlled by Admin Panel (Redis), with env fallback
  try {
    const multKey = await redis.get('price:xrp_per_wlo:multiplier');
    const floorKey = await redis.get('price:xrp_per_wlo:floor');
    const multRaw = multKey ?? process.env.PRICE_MULTIPLIER_XRP_PER_WLO;
    const floorRaw = floorKey ?? process.env.PRICE_FLOOR_XRP_PER_WLO;
    const multiplier = Number(multRaw);
    const floor = Number(floorRaw);
    let base = (typeof result.xrpPerWlo === 'number' && isFinite(result.xrpPerWlo)) ? result.xrpPerWlo : ((typeof result.best?.mid === 'number' && isFinite(result.best.mid)) ? result.best.mid : null);
    if (base && isFinite(base)) {
      let adj = base;
      if (isFinite(multiplier) && multiplier > 0) adj = adj * multiplier;
      if (isFinite(floor) && floor > 0) adj = Math.max(adj, floor);
      result.xrpPerWlo = adj;
      result.best.mid = adj;
      result.waldoPerXrp = 1 / adj;
    }
  } catch (_) { }


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

