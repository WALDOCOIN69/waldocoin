// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Proper CommonJS import
const XummSdk = require("xumm-sdk").default;

// ✅ Create an instance
const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// ✅ Export properly for ESM usage
export { xummClient };

// ✅ Optional: log confirmation
console.log("✅ xummClient.js initialized 🔐");
