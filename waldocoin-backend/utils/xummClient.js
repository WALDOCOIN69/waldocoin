// utils/xummClient.js
import pkg from 'xumm-sdk';
const { Xumm } = pkg;

if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
  console.error("❌ Missing XUMM credentials in .env");
  process.exit(1);
}

const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export { xummClient };
