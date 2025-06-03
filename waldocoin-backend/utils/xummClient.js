import pkg from "xumm-sdk";
const { Xumm } = pkg;

console.log("🧪 LOADED XUMM CLIENT CORRECTLY"); // <--- ADD THIS LINE

export const getXummClient = () =>
  new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
