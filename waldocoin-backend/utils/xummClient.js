// utils/xummClient.js
import { XummSdk } from 'xumm-sdk';
import dotenv from 'dotenv';

dotenv.config();

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

export default xumm;

