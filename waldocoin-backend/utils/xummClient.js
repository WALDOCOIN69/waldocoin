// utils/xummClient.js
import { XummSdk } from 'xumm-sdk';

console.log("🧪 XUMM_API_KEY:", process.env.XUMM_API_KEY);
console.log("🧪 XUMM_API_SECRET:", process.env.XUMM_API_SECRET);

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

export default xumm;
