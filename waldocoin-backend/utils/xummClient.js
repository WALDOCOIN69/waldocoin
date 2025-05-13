// utils/xummClient.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ This is the actual constructor
const XummSdk = require("xumm-sdk");

// ✅ Instantiate directly
const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

export default xumm;
