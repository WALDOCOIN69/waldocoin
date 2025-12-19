// routes/userLevel.js - User level progression API
import express from "express";
import { 
  getXP, 
  getWalletProgression, 
  getWalletLevel,
  addXP 
} from "../utils/xpManager.js";

const router = express.Router();

console.log("🧩 Loaded: routes/userLevel.js");

// GET /api/userLevel/:wallet - Get user level and progression
router.get("/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || !wallet.startsWith("r")) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid wallet address" 
      });
    }

    const progression = await getWalletProgression(wallet);
    const totalXp = await getXP(wallet);

    return res.json({
      success: true,
      wallet,
      totalXp,
      level: progression.currentLevel.level,
      title: progression.currentLevel.title,
      multiplier: progression.currentLevel.multiplier,
      progress: progression.progress,
      xpToNext: progression.xpToNext,
      xpInCurrentLevel: progression.xpInCurrentLevel,
      nextLevel: progression.nextLevel ? {
        level: progression.nextLevel.level,
        title: progression.nextLevel.title,
        threshold: progression.nextLevel.threshold
      } : null,
      isMaxLevel: !progression.nextLevel
    });

  } catch (error) {
    console.error("❌ Error getting user level:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to get user level" 
    });
  }
});

// POST /api/userLevel/addXP - Add XP to user (admin/testing)
router.post("/addXP", async (req, res) => {
  try {
    const { wallet, amount, adminKey } = req.body;
    
    // Simple admin protection (you can enhance this)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        success: false, 
        error: "Unauthorized" 
      });
    }

    if (!wallet || !amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid wallet or amount" 
      });
    }

    const result = await addXP(wallet, amount);

    return res.json({
      success: true,
      result: {
        wallet: result.wallet,
        xpGained: result.xpGained,
        oldXp: result.oldXp,
        newXp: result.newXp,
        oldLevel: result.oldLevel,
        newLevel: result.newLevel,
        leveledUp: result.leveledUp,
        multiplier: result.multiplier
      }
    });

  } catch (error) {
    console.error("❌ Error adding XP:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Failed to add XP" 
    });
  }
});

// GET /api/userLevel/levels - Get all level information
router.get("/", async (_, res) => {
  try {
    return res.json({
      success: true,
      levels: [
        { level: 1, threshold: 0, title: "Waldo Watcher", multiplier: 1.0 },
        { level: 2, threshold: 1000, title: "Waldo Scout", multiplier: 0.95 },
        { level: 3, threshold: 3000, title: "Waldo Agent", multiplier: 0.9 },
        { level: 4, threshold: 7000, title: "Waldo Commander", multiplier: 0.85 },
        { level: 5, threshold: 15000, title: "Waldo Legend", multiplier: 0.8 },
        { level: 6, threshold: 30000, title: "Waldo Master", multiplier: 0.7 },
        { level: 7, threshold: 50000, title: "Waldo King", multiplier: 0.6 }
      ],
      description: "7-level progression system with diminishing XP returns as users advance"
    });

  } catch (error) {
    console.error("❌ Error getting levels:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get level information"
    });
  }
});

export default router;
