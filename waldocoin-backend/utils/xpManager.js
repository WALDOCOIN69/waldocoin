// utils/xpManager.js - Consolidated XP Management System
import { redis } from "../redisClient.js";

// 🔢 XP thresholds for 7-level progression system
const XP_LEVELS = [
  { level: 1, threshold: 0, title: "Waldo Watcher", multiplier: 1.0 },
  { level: 2, threshold: 1000, title: "Waldo Scout", multiplier: 0.95 },
  { level: 3, threshold: 3000, title: "Waldo Agent", multiplier: 0.9 },
  { level: 4, threshold: 7000, title: "Waldo Commander", multiplier: 0.85 },
  { level: 5, threshold: 15000, title: "Waldo Legend", multiplier: 0.8 },
  { level: 6, threshold: 30000, title: "Waldo Master", multiplier: 0.7 },
  { level: 7, threshold: 50000, title: "Waldo King", multiplier: 0.6 }
];

// Legacy XP thresholds for backward compatibility
const XP_THRESHOLDS = {
  watcher: 0,
  scout: 1000,
  agent: 3000,
  commander: 7000,
  legend: 15000,
  master: 30000,
  king: 50000
};

// 🧠 XP gain rules (from legacy xp.js):
// - Up to 60 XP: 1 XP per 25 likes
// - 61–100 XP: 1 XP per 50 likes
// - 101+ XP: 1 XP per 100 likes

// 🧠 Redis key helper
const getXPKey = (wallet) => `xp:${wallet}`;

// ➕ Add XP to wallet with dynamic scaling and return details
export const addXP = async (wallet, baseAmount) => {
  const key = getXPKey(wallet);
  const currentXp = await getXP(wallet);
  const currentLevel = getXPLevel(currentXp);

  // Apply level-based multiplier for diminishing returns
  const scaledAmount = Math.floor(baseAmount * currentLevel.multiplier);
  const actualAmount = Math.max(1, scaledAmount); // Minimum 1 XP

  await redis.incrBy(key, actualAmount);
  const newTotal = await redis.get(key);
  const finalXp = parseInt(newTotal, 10) || 0;

  // Check for level up
  const newLevel = getXPLevel(finalXp);
  const leveledUp = newLevel.level > currentLevel.level;

  return {
    wallet,
    oldXp: currentXp,
    xpGained: actualAmount,
    newXp: finalXp,
    oldLevel: currentLevel,
    newLevel: newLevel,
    leveledUp,
    multiplier: currentLevel.multiplier
  };
};

// ➕ Legacy addXP function for backward compatibility
export const addXPLegacy = async (wallet, amount) => {
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

// 🏆 Get level info based on XP
export const getXPLevel = (xp) => {
  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= XP_LEVELS[i].threshold) {
      return XP_LEVELS[i];
    }
  }
  return XP_LEVELS[0]; // Default to level 1
};

// 📊 Get detailed level progression info
export const getLevelProgress = (xp) => {
  const currentLevel = getXPLevel(xp);
  const nextLevelIndex = XP_LEVELS.findIndex(l => l.level === currentLevel.level) + 1;
  const nextLevel = nextLevelIndex < XP_LEVELS.length ? XP_LEVELS[nextLevelIndex] : null;

  if (!nextLevel) {
    return {
      currentLevel,
      nextLevel: null,
      progress: 100,
      xpToNext: 0,
      xpInCurrentLevel: xp - currentLevel.threshold
    };
  }

  const xpInCurrentLevel = xp - currentLevel.threshold;
  const xpNeededForNext = nextLevel.threshold - currentLevel.threshold;
  const progress = Math.floor((xpInCurrentLevel / xpNeededForNext) * 100);

  return {
    currentLevel,
    nextLevel,
    progress: Math.min(100, progress),
    xpToNext: nextLevel.threshold - xp,
    xpInCurrentLevel
  };
};

// 🎖 Get level info for wallet
export const getWalletLevel = async (wallet) => {
  const xp = await getXP(wallet);
  return getXPLevel(xp);
};

// 🎖 Get full progression for wallet
export const getWalletProgression = async (wallet) => {
  const xp = await getXP(wallet);
  return getLevelProgress(xp);
};

// 🏆 Legacy tier function for backward compatibility
export const getXPTier = (xp) => {
  const level = getXPLevel(xp);
  return level.title;
};

// 🎖 Legacy tier for wallet
export const getXpTier = (xp) => {
  if (xp >= 200) return "Legendary";
  if (xp >= 120) return "Epic";
  if (xp >= 60) return "Rare";
  if (xp >= 20) return "Common";
  return "Newbie";
};

// 📊 Calculate XP reward with diminishing returns (from legacy xp.js)
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

// 👤 Get user XP (from legacy xp.js)
export const getUserXp = async (wallet) => {
  const xp = parseInt(await redis.get(`xp:${wallet}`)) || 0;
  return xp;
};

export const getWalletTier = async (wallet) => {
  const xp = await getXP(wallet);
  return getXPTier(xp);
};
