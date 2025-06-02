// utils/xummClient.js
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

export default async function getXummClient() {
  const { XUMM_API_KEY, XUMM_API_SECRET } = process.env;

  if (!XUMM_API_KEY || !XUMM_API_SECRET) {
    throw new Error("❌ Missing XUMM credentials");
  }

  return new XummSdk(XUMM_API_KEY, XUMM_API_SECRET);
}

