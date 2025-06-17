// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

console.log("🧪 Instantiating XUMM SDK...");

// ⛑ Use dynamic import for CommonJS module in ESM
const { default: Xumm } = await import("xumm-sdk");

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM API credentials");
  process.exit(1);
}

export const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ xummClient.js initialized 🔍");
