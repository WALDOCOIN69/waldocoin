// utils/xummClient.js
import pkg from "xumm-sdk";
const { Xumm } = pkg;

export const getXummClient = () =>
  new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

