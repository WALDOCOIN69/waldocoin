const { XummSdk } = require("xumm-sdk"); // ✅ CORRECT constructor
require("dotenv").config();

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM credentials");
  process.exit(1);
}

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
module.exports = xummClient;
