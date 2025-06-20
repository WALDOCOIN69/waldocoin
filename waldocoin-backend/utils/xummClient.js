// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Load the CJS-wrapped XUMM SDK instance
const xummClient = require("./xummClient.cjs");

// ✅ Re-export as named export for ESM compatibility
export { xummClient };

// ✅ Optional: log for confirmation in server logs
console.log("✅ xummClient.js initialized 🔍");
