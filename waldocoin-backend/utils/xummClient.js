// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import Xumm from "xumm-sdk"; // ✅ Import default, NOT destructured!

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM API credentials");
  process.exit(1);
}

console.log("🧪 Instantiating XUMM SDK...");
export const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ xummClient.js initialized 🔍");
