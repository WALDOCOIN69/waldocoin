// utils/xummClient.js
import pkg from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

const { Xumm } = pkg;

let xummClient = null;

export function getXummClient() {
  if (!xummClient) {
    console.log("🧪 Instantiating XUMM SDK...");
    xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
    console.log("✅ XUMM Client loaded");
  }
  return xummClient;
}
