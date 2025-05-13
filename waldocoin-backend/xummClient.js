// utils/xummClient.cjs
const { XummSdk } = require('xumm-sdk');

const xumm = new XummSdk(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

module.exports = xumm;
