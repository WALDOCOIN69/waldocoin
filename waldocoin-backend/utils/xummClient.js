// utils/xummClient.js
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";

dotenv.config();

const { XUMM_API_KEY, XUMM_API_SECRET } = process.env;

if (!XUMM_API_KEY || !XUMM_API_SECRET) {
  throw new Error("❌ Missing XUMM credentials");
}

// ✅ create one persistent XUMM client instance
const xummClientInstance = new XummSdk(XUMM_API_KEY, XUMM_API_SECRET);

export default function getXummClient() {
  return xummClientInstance;
}
