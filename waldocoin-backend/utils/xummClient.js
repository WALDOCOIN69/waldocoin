// utils/xummClient.js
import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

// ✅ Create persistent instance ONCE
const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

console.log("🧪 LOADED XUMM CLIENT CORRECTLY WaldoCoin");

export default xummClient;
