// utils/xummClient.js
import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Use CJS require to get the constructor
const { Xumm } = require("xumm-sdk");

// ✅ Instantiate the client
const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

// ✅ Named export
export { xummClient };

