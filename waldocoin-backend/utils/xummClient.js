// utils/xummClient.js
import { createRequire } from "module";
const require = createRequire(import.meta.url); // ✅ Needed for CommonJS compatibility

const XummSdk = require("xumm-sdk").default; // ✅ THIS LINE FIXES IT
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

console.log("🧩 xummClient.js was loaded 🔍");
