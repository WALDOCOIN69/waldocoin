// utils/xummClient.js
import { XummSdk } from 'xumm-sdk';

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

// Optional debug log
console.log("🔐 XUMM Key:", process.env.XUMM_API_KEY?.slice(0, 8) + "...");
console.log("🔐 XUMM Secret:", process.env.XUMM_API_SECRET?.slice(0, 8) + "...");

export default xumm;
