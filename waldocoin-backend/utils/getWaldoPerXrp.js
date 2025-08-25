import fetch from "node-fetch";
import { redis } from "../redisClient.js";

const CACHE_KEY = "conversion:waldo_per_xrp";
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Fetch WALDO per 1 XRP from Magnetic (configurable), with Redis cache and safe fallbacks.
 * Env config:
 *  - MAGNETIC_PRICE_URL: full URL to fetch price JSON
 *  - MAGNETIC_PRICE_FIELD: JSON field to read (default: "waldoPerXrp")
 *  - MAGNETIC_PRICE_MODE: "WALDO_PER_XRP" (default) or "XRP_PER_WALDO" (invert)
 * If Magnetic is not configured or fails, fall back to cached Redis value or 10000.
 */
export async function getWaldoPerXrp() {
  // Try cache first
  const cachedRaw = await redis.get(CACHE_KEY);
  let cached = parseFloat(cachedRaw);

  const url = process.env.MAGNETIC_PRICE_URL;
  const field = process.env.MAGNETIC_PRICE_FIELD || "waldoPerXrp";
  const mode = (process.env.MAGNETIC_PRICE_MODE || "WALDO_PER_XRP").toUpperCase();

  if (url) {
    try {
      const resp = await fetch(url, { timeout: 8000 });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      let val = data?.[field];
      if (typeof val !== "number") {
        // Try common alternates
        if (typeof data?.waldoPerXrp === "number") val = data.waldoPerXrp;
        else if (typeof data?.xrpPerWaldo === "number") val = 1 / data.xrpPerWaldo;
        else if (typeof data?.price === "number" && mode === "WALDO_PER_XRP") val = data.price;
        else if (typeof data?.price === "number" && mode === "XRP_PER_WALDO") val = 1 / data.price;
      }
      if (typeof val === "number" && isFinite(val) && val > 0) {
        await redis.set(CACHE_KEY, String(val), { EX: CACHE_TTL_SECONDS });
        return val;
      }
      throw new Error("Unrecognized Magnetic price response format");
    } catch (e) {
      console.warn(`⚠️ Magnetic price fetch failed: ${e?.message || e}`);
      // Fall through to cached value
    }
  }

  if (isFinite(cached) && cached > 0) return cached;
  // Final fallback: align with presale base rate (1 XRP = 10,000 WALDO)
  return 10000;
}

export default getWaldoPerXrp;

