// utils/xummClient.js
import { XummSdk } from "xumm-sdk";

console.log("🧪 Initializing XummSdk singleton client");

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xummClient;
