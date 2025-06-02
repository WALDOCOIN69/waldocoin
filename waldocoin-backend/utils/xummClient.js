// utils/xummClient.js
import { XummSdk } from "xumm-sdk";

let client = null;

export default function getXummClient() {
  if (!client || client?.isClosed) {
    const { XUMM_API_KEY, XUMM_API_SECRET } = process.env;

    if (!XUMM_API_KEY || !XUMM_API_SECRET) {
      console.error("❌ Missing XUMM credentials");
      throw new Error("Missing XUMM credentials");
    }

    console.log("✅ Initializing fresh XUMM client...");
    client = new XummSdk(XUMM_API_KEY, XUMM_API_SECRET);
  }

  return client;
}
