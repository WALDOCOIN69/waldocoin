import express from "express";
const router = express.Router();

// 📜 Admin Logs (Mock)
router.get("/logs", (req, res) => {
  res.json([
    { timestamp: new Date().toISOString(), action: "Airdrop sent to rXYZ" },
    { timestamp: new Date().toISOString(), action: "Fake battle created" },
    { timestamp: new Date().toISOString(), action: "XP leaderboard updated" }
  ]);
});

export default router;
