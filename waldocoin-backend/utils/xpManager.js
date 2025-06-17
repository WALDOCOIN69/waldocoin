// utils/xpManager.js
import redis from "./redisClient.js";

// 🔢 XP thresholds for meme levels (can expand later)
const XP_THRESHOLDS = {
  common: 0,
  rare: 60,
  epic: 100,
  legendary: 200,
};

// 🧠 Get Redis key for wallet XP
const getXPKey = (wallet) => `xp:${wallet}`;

// ➕ Add XP to a wallet
export const addXP = async (wallet, amount) => {
  const key = getXPKey(wallet);
  await redis.incrby(key, amount);
  const totalXP = await redis.get(key);
  return parseInt(totalXP, 10) || 0;
};

// 📊 Get XP for a wallet
export const getXP = async (wallet) => {
  const key = getXPKey(wallet);
  const value = await redis.get(key);
  return parseInt(value, 10) || 0;
};

// 🏆 Get tier name based on XP value
export const getXPTier = (xp) => {
  if (xp >= XP_THRESHOLDS.legendary) return "Legendary";
  if (xp >= XP_THRESHOLDS.epic) return "Epic";
  if (xp >= XP_THRESHOLDS.rare) return "Rare";
  return "Common";
};

// 🧠 Get current tier for a wallet
export const getWalletTier = async (wallet) => {
  const xp = await getXP(wallet);
  return getXPTier(xp);
};
