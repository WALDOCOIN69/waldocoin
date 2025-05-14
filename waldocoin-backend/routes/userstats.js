// routes/userstats.js
import express from "express";
const router = express.Router();

// Dummy user stats – replace this with real DB/Redis logic later
router.get("/", async (req, res) => {
  const { wallet } = req.query;
  if (!wallet) {
    return res.status(400).json({ error: "Wallet address is required." });
  }

  res.json({
    wallet,
    xp: 420,
    level: 3,
    title: "Meme Knight",
    likes: 1000,
    retweets: 300,
    memes: 5,
    battles: 2,
    referrals: []
  });
});

export default router;

