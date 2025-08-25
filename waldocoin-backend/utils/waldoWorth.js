import { redis } from "../redisClient.js";
import getWaldoBalance from "./getWaldoBalance.js";

/**
 * Ensure a wallet holds at least `minXrp` XRP worth of WALDO.
 * Uses admin-configurable Redis key conversion:waldo_per_xrp (WALDO per 1 XRP).
 * Falls back to 10000 WALDO/XRP if not set, to align with presale base rate.
 */
export async function ensureMinWaldoWorth(wallet, minXrp = 3) {
  const waldoPerXrpRaw = await redis.get("conversion:waldo_per_xrp");
  const waldoPerXrp = parseInt(waldoPerXrpRaw) || 10000;
  const requiredWaldo = Math.ceil(minXrp * waldoPerXrp);
  const balance = await getWaldoBalance(wallet);
  const ok = (balance || 0) >= requiredWaldo;
  return { ok, requiredWaldo, waldoPerXrp, minXrp, balance: balance || 0 };
}

export default ensureMinWaldoWorth;

