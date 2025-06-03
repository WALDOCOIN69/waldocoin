import pkg from "xumm-sdk";
const { Xumm } = pkg;

console.log("🧨 FORCING REBUILD TO PURGE CACHE");
console.log("🧪 LOADED XUMM CLIENT CORRECTLY");

export const getXummClient = () =>
  new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
