import express from "express";
const router = express.Router();

// 🪵 Mock Admin Logs
router.get("/logs", (req, res) => {
  res.json([
    { timestamp: Date.now(), action: "Created test battle", by: "admin" },
    { timestamp: Date.now(), action: "Reset active battle", by: "admin" },
    { timestamp: Date.now(), action: "Airdrop executed", by: "system" }
  ]);
});

export default router;
