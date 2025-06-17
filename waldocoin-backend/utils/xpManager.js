// utils/xpManager.js
import { redis } from "../redisClient.js";

// 🔢 XP thresholds for meme levels (editable config)
const XP_THRESHOLDS = {
  common: 0,
  rare: 60,
  epic: 100,
  legendary: 200,
};

// 🧠 Redis key helper
const getXPKey = (wallet) => `xp:${wallet}`;

// ➕ Add XP to wallet and return total
export const addXP = async (wallet, amount) => {
  const key = getXPKey(wallet);
  await redis.incrBy(key, amount);
  const total = await redis.get(key);
  return parseInt(total, 10) || 0;
};

// 📊 Get current XP
export const getXP = async (wallet) => {
  const val = await redis.get(getXPKey(wallet));
  return parseInt(val, 10) || 0;
};

// 🏆 Get tier based on XP
export const getXPTier = (xp) => {
  if (xp >= XP_THRESHOLDS.legendary) return "Legendary";
  if (xp >= XP_THRESHOLDS.epic) return "Epic";
  if (xp >= XP_THRESHOLDS.rare) return "Rare";
  return "Common";
};

// 🎖 Get tier for wallet
export const getWalletTier = async (wallet) => {
  const xp = await getXP(wallet);
  return getXPTier(xp);
};
