// constants.js
import dotenv from "dotenv";
import xrpl from "xrpl";

dotenv.config();
export const DISTRIBUTOR_WALLET = "rJGYLktGg1FgAa4t2yfA8tnyMUGsyxofUC";
export const WALDOCOIN_TOKEN = "WLO"; // WALDO token code
export const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"; // WALDO issuer address
export const WALDO_DISTRIBUTOR_SECRET = process.env.WALDO_DISTRIBUTOR_SECRET;

if (WALDO_DISTRIBUTOR_SECRET) {
  console.log("WALDO_DISTRIBUTOR_SECRET:", WALDO_DISTRIBUTOR_SECRET ? "Loaded" : "MISSING");
  try {
    const wallet = xrpl.Wallet.fromSeed(WALDO_DISTRIBUTOR_SECRET);
    console.log("WALDO_DISTRIBUTOR_ADDRESS:", wallet.classicAddress);
  } catch (e) {
    console.error("❌ Invalid WALDO_DISTRIBUTOR_SECRET:", e.message);
  }
} else {
  console.error("❌ WALDO_DISTRIBUTOR_SECRET not found in environment variables");
}
