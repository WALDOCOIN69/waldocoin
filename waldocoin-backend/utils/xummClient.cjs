// utils/xummClient.cjs
const Xumm = require("xumm-sdk"); // ✅ DO NOT destructure
require("dotenv").config();

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM credentials");
  process.exit(1);
}

const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
module.exports = xummClient;
