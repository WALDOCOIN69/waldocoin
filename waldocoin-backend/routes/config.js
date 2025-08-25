import express from "express";
import { getBattleFees, setBattleFees, getPublicConfig } from "../utils/config.js";

const router = express.Router();

// GET /api/config/public - public config (for UI)
router.get("/public", async (req, res) => {
  try {
    const cfg = await getPublicConfig();
    res.json({ success: true, config: cfg });
  } catch (e) {
    console.error("/api/config/public error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to load config" });
  }
});

// POST /api/config/battle - admin: set battle fees and toggle defaults
router.post("/battle", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { useDefaults, startFeeWLO, acceptFeeWLO, voteFeeWLO } = req.body || {};
    await setBattleFees({ useDefaults, startFeeWLO, acceptFeeWLO, voteFeeWLO });
    const cfg = await getBattleFees();
    res.json({ success: true, battle: cfg });
  } catch (e) {
    console.error("/api/config/battle error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to save battle config" });
  }
});

export default router;

