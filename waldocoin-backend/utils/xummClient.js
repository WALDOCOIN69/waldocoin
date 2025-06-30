import { XummSdk } from 'xumm-sdk';

console.log("XUMM KEY:", process.env.XUMM_API_KEY ? "Loaded" : "MISSING");
console.log("XUMM SECRET:", process.env.XUMM_API_SECRET ? "Loaded" : "MISSING");

const xummClient = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET,
  'mainnet' // 👈 FORCE MAINNET!
);

export { xummClient };

