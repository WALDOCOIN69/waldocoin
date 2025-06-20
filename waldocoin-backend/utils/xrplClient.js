// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Load the CJS-wrapped XUMM SDK instance
const { Xumm } = require("xumm-sdk");

// ✅ Initialize and export as named export
const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
export { xummClient };

// ✅ Log for sanity check
console.log("✅ xummClient.js initialized 🔍");
