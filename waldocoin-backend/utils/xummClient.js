// utils/xummClient.js
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

// ✅ Singleton instance
const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xummClient;
