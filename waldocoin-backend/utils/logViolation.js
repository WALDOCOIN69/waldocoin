// utils/logViolation.js

export const logViolation = async (wallet, type, details = {}) => {
  console.log(`🚨 [${type}] Violation from wallet: ${wallet}`);
  if (Object.keys(details).length > 0) {
    console.log("📋 Details:", details);
  }
};
