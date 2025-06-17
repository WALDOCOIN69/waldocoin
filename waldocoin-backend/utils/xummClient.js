// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Load CJS wrapper
export const xummClient = require("./xummClient.cjs");

console.log("✅ xummClient.js initialized 🔍");
