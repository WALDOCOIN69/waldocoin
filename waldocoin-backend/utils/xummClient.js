// utils/xummClient.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ Just require the SDK — it IS the class
const Xumm = require("xumm-sdk");

// ✅ Instantiate directly
const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xumm;
