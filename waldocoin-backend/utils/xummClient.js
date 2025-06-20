// utils/xummClient.js
import pkg from "xumm-sdk";
const XummSdk = pkg.default;

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM credentials");
  process.exit(1);
}

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
export default xummClient;
