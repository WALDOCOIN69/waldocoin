// utils/xpManager.js
import { redis } from "../redisClient.js";

// 🔢 XP thresholds for 5-level progression system
const XP_LEVELS = [
  { level: 1, threshold: 0, title: "Fresh Poster", multiplier: 1.0 },
  { level: 2, threshold: 250, title: "Shitposter", multiplier: 0.9 },
  { level: 3, threshold: 850, title: "Meme Dealer", multiplier: 0.8 },
  { level: 4, threshold: 1750, title: "OG Degen", multiplier: 0.7 },
  { level: 5, threshold: 3000, title: "WALDO Master", multiplier: 0.6 }
];

// Legacy XP thresholds for backward compatibility
const XP_THRESHOLDS = {
  common: 0,
  rare: 250,
  epic: 850,
  legendary: 1750,
  master: 3000
};

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
export const getWalletTier = async (wallet) => {
  const xp = await getXP(wallet);
  return getXPTier(xp);
};
