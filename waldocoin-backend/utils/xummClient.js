// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import pkg from "xumm-sdk";
const { Xumm } = pkg;

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  throw new Error("❌ Missing XUMM_API_KEY or XUMM_API_SECRET");
}

console.log("🧪 Instantiating XUMM SDK...");
export const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ xummClient.js initialized 🔍");

