const { Xumm } = require('xumm-sdk');

const xumm = new Xumm(
  process.env.XUMM_API_KEY,
  process.env.XUMM_API_SECRET
);

module.exports = xumm;
