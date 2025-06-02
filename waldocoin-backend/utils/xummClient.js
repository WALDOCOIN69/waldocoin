// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config(); // ✅ This must run before accessing process.env

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM API credentials in environment.");
  process.exit(1); // Prevent the app from running if keys are missing
}


import { XummSdk } from "xumm-sdk";

console.log("🧪 XUMM_API_KEY:", process.env.XUMM_API_KEY);
console.log("🧪 XUMM_API_SECRET:", process.env.XUMM_API_SECRET);

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

export default xumm;
