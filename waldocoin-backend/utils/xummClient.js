// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { XummSdk } from "xumm-sdk";

// ⚠️ No async, no dynamic import, no function-based client creation
const { XUMM_API_KEY, XUMM_API_SECRET } = process.env;

if (!XUMM_API_KEY || !XUMM_API_SECRET) {
  throw new Error("❌ Missing XUMM credentials");
}

console.log("✅ XUMM SDK initialized with persistent instance");

const xummClient = new XummSdk(XUMM_API_KEY, XUMM_API_SECRET);

// ✅ Export instance directly — no function wrapper!
export default xummClient;
