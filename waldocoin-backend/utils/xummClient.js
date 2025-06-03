// utils/xummClient.js
import { Xumm } from 'xumm-sdk';
import dotenv from 'dotenv';
dotenv.config();

export default async function getXummClient() {
  return new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
}

