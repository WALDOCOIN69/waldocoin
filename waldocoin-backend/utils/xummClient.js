// utils/xummClient.js
import pkg from "xumm-sdk";
const { Xumm } = pkg;

const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export const getXummClient = () => xummClient;

