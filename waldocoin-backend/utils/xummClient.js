// utils/xummClient.js
import pkg from "xumm-sdk";
const { XummSdk } = pkg;

export const getXummClient = () =>
  new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

