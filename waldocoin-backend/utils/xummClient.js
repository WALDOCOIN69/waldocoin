// utils/xummClient.js
import { XummSdk } from 'xumm-sdk';

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

console.log("🔐 XUMM_API_KEY Present?", !!process.env.XUMM_API_KEY);
console.log("🔐 XUMM_API_SECRET Present?", !!process.env.XUMM_API_SECRET);

export default xumm;
