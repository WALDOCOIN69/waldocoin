import getWaldoBalance from "./getWaldoBalance.js";
import getWaldoPerXrp from "./getWaldoPerXrp.js";

/**
 * Ensure a wallet holds at least `minXrp` XRP worth of WALDO.
 * Uses Magnetic price via getWaldoPerXrp (cached in Redis) with 10,000 fallback.
 */
export async function ensureMinWaldoWorth(wallet, minXrp = 3) {
  const waldoPerXrp = await getWaldoPerXrp();
  const requiredWaldo = Math.ceil(minXrp * waldoPerXrp);
  const balance = await getWaldoBalance(wallet);
  const ok = (balance || 0) >= requiredWaldo;
  return { ok, requiredWaldo, waldoPerXrp, minXrp, balance: balance || 0 };
}

export default ensureMinWaldoWorth;

