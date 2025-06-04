// utils/xummClient.js
import { XummSdk } from "xumm-sdk";

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// Optional: Perform a harmless test to validate client instantiation
(async () => {
  try {
    const pong = await xummClient.ping();
    console.log("🧪 LOADED XUMM CLIENT CORRECTLY", pong.application.name);
  } catch (err) {
    console.error("❌ Failed to init XUMM client at startup:", err?.message || err);
  }
})();

export default xummClient;
