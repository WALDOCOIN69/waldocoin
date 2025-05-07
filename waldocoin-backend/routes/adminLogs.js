import express from "express";
const router = express.Router();

router.get("/logs", (req, res) => {
  res.json([
    { type: "login", wallet: "rABC123", timestamp: new Date().toISOString() },
    { type: "mint", wallet: "rDEF456", timestamp: new Date().toISOString() },
    { type: "claim", wallet: "rGHI789", timestamp: new Date().toISOString() }
  ]);
});

export default router;
