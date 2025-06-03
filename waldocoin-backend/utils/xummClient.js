import { Xumm } from "xumm-sdk";

export const getXummClient = () =>
  new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);


