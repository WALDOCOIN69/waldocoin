// utils/xummClient.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { Xumm } = require("xumm-sdk"); // ✅ Force CommonJS-style require

const xumm = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
export default xumm;
