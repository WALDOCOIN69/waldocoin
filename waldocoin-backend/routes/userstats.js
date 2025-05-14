import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  const wallet = req.query.wallet;

  // Simulate "realistic" user stats
  const fakeUserStats = {
    wallet,
    xp: 850, // Adjust to simulate different levels
    level: 3,
    title: "Meme Knight",
    likes: 1125,
    retweets: 225,
    memes: 5,
    battles: 2,
    referrals: ["rTestReferrer1", "rTestReferrer2"]
  };

  res.json(fakeUserStats);
});

export default router;

