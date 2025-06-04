// utils/xummClient.js
import { XummSdk } from "xumm-sdk";

export const getXummClient = () => {
  console.log("🛠️ Fresh XummSdk instance created");
  return new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
};

