// utils/xummClient.js
import xummSdkImport from 'xumm-sdk';

const XummSdk = xummSdkImport.default || xummSdkImport;

console.log("✅ Creating XUMM instance in helper");
const xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export default xumm;
