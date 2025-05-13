// utils/xummClient.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Import the whole SDK (which is the class itself)
const XummSdk = require("xumm-sdk");

// ✅ Instantiate directly
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xumm;
