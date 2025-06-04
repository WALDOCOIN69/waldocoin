// utils/xummClient.js
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

let xummClient = null;

export function getXummClient() {
  if (!xummClient) {
    console.log("🧪 Instantiating XUMM SDK...");
    xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
    console.log("✅ XUMM Client loaded");
  }
  return xummClient;
}
