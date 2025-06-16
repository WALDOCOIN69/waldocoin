import dotenv from "dotenv";
dotenv.config();

import { XummSdk } from "xumm-sdk";

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  throw new Error("❌ Missing XUMM_API_KEY or XUMM_API_SECRET");
}

console.log("🧪 Instantiating XUMM SDK...");
export const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ xummClient.js initialized 🔍");

