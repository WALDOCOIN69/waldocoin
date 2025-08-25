import express from "express";
import { getBattleFees, setBattleFees, getPublicConfig, getClaimConfig, setClaimConfig, getNftConfig, setNftConfig, getDaoConfig, setDaoConfig, getStakingConfig, setStakingConfig } from "../utils/config.js";

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

// Claim config
router.post("/claim", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) return res.status(403).json({ success: false, error: "Unauthorized" });
    const { useDefaults, instantFeeRate, stakedFeeRate, burnRate } = req.body || {};
    await setClaimConfig({ useDefaults, instantFeeRate, stakedFeeRate, burnRate });
    res.json({ success: true, claim: await getClaimConfig() });
  } catch (e) {
    console.error("/api/config/claim error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to save claim config" });
  }
});

// NFT config
router.post("/nft", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) return res.status(403).json({ success: false, error: "Unauthorized" });
    const { useDefaults, mintCostWLO } = req.body || {};
    await setNftConfig({ useDefaults, mintCostWLO });
    res.json({ success: true, nft: await getNftConfig() });
  } catch (e) {
    console.error("/api/config/nft error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to save NFT config" });
  }
});

// DAO config
router.post("/dao", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) return res.status(403).json({ success: false, error: "Unauthorized" });
    const { useDefaults, votingRequirementWLO } = req.body || {};
    await setDaoConfig({ useDefaults, votingRequirementWLO });
    res.json({ success: true, dao: await getDaoConfig() });
  } catch (e) {
    console.error("/api/config/dao error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to save DAO config" });
  }
});

// Staking config
router.post("/staking", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) return res.status(403).json({ success: false, error: "Unauthorized" });
    const { useDefaults, minimumAmountLongTerm, earlyUnstakePenalty, maxActiveStakes } = req.body || {};
    await setStakingConfig({ useDefaults, minimumAmountLongTerm, earlyUnstakePenalty, maxActiveStakes });
    res.json({ success: true, staking: await getStakingConfig() });
  } catch (e) {
    console.error("/api/config/staking error:", e.message || e);
    res.status(500).json({ success: false, error: "Failed to save staking config" });
  }
});


export default router;

