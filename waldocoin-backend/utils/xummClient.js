import pkg from "xumm-sdk"; // default import of CommonJS module
const { Xumm } = pkg;

const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);

export { xummClient };


