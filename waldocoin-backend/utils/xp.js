// utils/xp.js
import { redis } from "../redisClient.js";

// 🧠 XP gain rules:
// - Up to 60 XP: 1 XP per 25 likes
// - 61–100 XP: 1 XP per 50 likes
// - 101+ XP: 1 XP per 100 likes

export const calculateXpReward = async (wallet, baseXp = 10) => {
  const xpKey = `xp:${wallet}`;
  const currentXp = parseInt(await redis.get(xpKey)) || 0;

  let xpGain = baseXp;

  // Apply diminishing returns if above certain thresholds
  if (currentXp >= 100) {
    xpGain = Math.floor(baseXp / 4); // 75% slower
  } else if (currentXp >= 60) {
    xpGain = Math.floor(baseXp / 2); // 50% slower
  }

  const newXp = currentXp + xpGain;
  await redis.set(xpKey, newXp);

  return { wallet, oldXp: currentXp, xpGain, newXp };
};

export const getUserXp = async (wallet) => {
  const xp = parseInt(await redis.get(`xp:${wallet}`)) || 0;
  return xp;
};

export const getXpTier = (xp) => {
  if (xp >= 200) return "Legendary";
  if (xp >= 120) return "Epic";
  if (xp >= 60) return "Rare";
  if (xp >= 20) return "Common";
  return "Newbie";
};
