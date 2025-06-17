// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import pkg from "xumm-sdk";
const Xumm = pkg.default || pkg; // ✅ Ensures compatibility with CommonJS default

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM API credentials");
  process.exit(1);
}

console.log("🧪 Instantiating XUMM SDK...");
export const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ xummClient.js initialized 🔍");
