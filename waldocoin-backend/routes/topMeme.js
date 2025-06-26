// routes/topMeme.js
import express from "express";
const router = express.Router();

// Dummy data – replace with actual DB logic later
router.get("/", (req, res) => {
  return res.json({
    tweetId: "1780000000000000000",
    image: "https://waldocoin.live/wp-content/uploads/2025/04/top-meme.png",
    xp: 120,
    tier: "Legendary"
  });
});

export default router;
