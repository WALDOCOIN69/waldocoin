// constants.js
import dotenv from "dotenv";
import xrpl from "xrpl";

dotenv.config();

// ===== WALLET ADDRESSES =====
export const DISTRIBUTOR_WALLET = process.env.DISTRIBUTOR_WALLET || "rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL";
export const TREASURY_WALLET = process.env.TREASURY_WALLET || "r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K";
export const STAKING_VAULT_WALLET = process.env.STAKING_VAULT_WALLET || "rnWfL48YCknW6PYewFLKfMKUymHCfj3aww";
export const BURN_ADDRESS = "rrrrrrrrrrrrrrrrrrrrrhoLvTp"; // XRPL black hole address

// ===== TOKEN CONFIGURATION =====
export const WALDOCOIN_TOKEN = "WLO"; // WALDO token code
export const WALDO_ISSUER = "rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY"; // WALDO issuer address

// ===== WALLET SECRETS =====
export const DISTRIBUTOR_WALLET_SECRET = process.env.DISTRIBUTOR_WALLET_SECRET || process.env.WALDO_DISTRIBUTOR_SECRET;
export const TREASURY_WALLET_SECRET = process.env.TREASURY_WALLET_SECRET;

// Backwards compatibility
export const WALDO_DISTRIBUTOR_SECRET = DISTRIBUTOR_WALLET_SECRET;

if (DISTRIBUTOR_WALLET_SECRET) {
  console.log("DISTRIBUTOR_WALLET_SECRET:", "Loaded");
  try {
    const wallet = xrpl.Wallet.fromSeed(DISTRIBUTOR_WALLET_SECRET);
    console.log("DISTRIBUTOR_WALLET_ADDRESS:", wallet.classicAddress);
  } catch (e) {
    console.error("❌ Invalid DISTRIBUTOR_WALLET_SECRET (seed could not derive address):", e.message);
  }
} else {
  console.error("❌ DISTRIBUTOR_WALLET_SECRET not found in environment variables");
}
