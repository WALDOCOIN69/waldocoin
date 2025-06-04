// utils/xummClient.js
import pkg from "xumm-sdk"; // 👈 This is CRUCIAL — don't use `import { Xumm }`
const { Xumm } = pkg;

import dotenv from "dotenv";
dotenv.config();

let xummClient = null;

export function getXummClient() {
  if (!xummClient) {
    console.log("🧪 Instantiating XUMM SDK...");
    xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
    console.log("✅ XUMM Client loaded");
  }
  return xummClient;
}
// 🔁 Force redeploy - do not remove
console.log("🧩 xummClient.js was loaded 🔍");
