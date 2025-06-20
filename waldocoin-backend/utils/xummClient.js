// utils/xummClient.js
import { XummSdk } from 'xumm-sdk'; // ✅ named import with correct constructor name

const xummClient = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xummClient;
