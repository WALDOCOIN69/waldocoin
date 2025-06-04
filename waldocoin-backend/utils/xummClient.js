import { XummSdk } from "xumm-sdk";
import dotenv from "dotenv";
dotenv.config();

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
console.log("✅ Persistent XUMM Client instantiated at boot");

export default xummClient;
