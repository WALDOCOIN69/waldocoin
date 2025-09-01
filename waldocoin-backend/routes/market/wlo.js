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

    // Ask: people selling WLO for XRP (taker gets XRP, pays WLO)
    const asks = await client.request({
      command: "book_offers",
      taker_gets: { currency: "XRP" },
      taker_pays: { currency: CURRENCY, issuer: ISSUER },
      limit: 10,
    });

    let askPrice = null; // XRP per WLO
    if (asks.result?.offers?.length) {
      const best = asks.result.offers[0];
      // quality is TakerPays (WLO) per TakerGets (XRP drops) — use inverse to get XRP/WLO
      const q = best.quality
        ? parseFloat(best.quality)
        : (parseFloat(best.TakerPays.value) / (parseFloat(best.TakerGets) / 1_000_000));
      if (q > 0 && isFinite(q)) askPrice = 1 / q;
    }

    // Bid: people buying WLO with XRP (taker gets WLO, pays XRP)
    const bids = await client.request({
      command: "book_offers",
      taker_gets: { currency: CURRENCY, issuer: ISSUER },
      taker_pays: { currency: "XRP" },
      limit: 10,
    });

    let bidPrice = null; // XRP per WLO
    if (bids.result?.offers?.length) {
      const best = bids.result.offers[0];
      const q = best.quality
        ? parseFloat(best.quality)
        : (parseFloat(best.TakerPays) / 1_000_000) / parseFloat(best.TakerGets.value); // XRP/WLO
      if (q > 0 && isFinite(q)) bidPrice = q;
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
  } catch (e) {}

  return res.json(result);
});

export default router;

