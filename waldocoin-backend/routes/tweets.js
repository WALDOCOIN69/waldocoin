import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) {
    return res.status(400).json({ error: "Wallet not provided" });
  }

  // Fake test data
  const tweets = [
    {
      wallet,
      tweet_id: "1780011111111111111",
      image_url: "https://via.placeholder.com/300x200.png?text=Meme+1",
      likes: 180,
      retweets: 30,
      waldo_amount: 4.5
    },
    {
      wallet,
      tweet_id: "1780022222222222222",
      image_url: "https://via.placeholder.com/300x200.png?text=Meme+2",
      likes: 320,
      retweets: 75,
      waldo_amount: 9.3
    }
  ];

  res.json(tweets);
});

export default router;
