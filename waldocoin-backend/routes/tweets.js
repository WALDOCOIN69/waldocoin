// routes/tweets.js
import express from "express";
import { TwitterApi } from "twitter-api-v2";
import { redis } from "../redisClient.js";

dotenv.config();
const router = express.Router();
const twitterClient = new TwitterApi(process.env.TWITTER_BEARER);

// Set to true to enable static dummy data
const USE_FAKE_DATA = true;

router.get("/", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet not provided" });

  if (USE_FAKE_DATA) {
    const tweets = [
      {
        wallet,
        tweet_id: "1780011111111111111",
        image_url: "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes: 180,
        retweets: 30,
        waldo_amount: 4.5,
        nftMinted: false
      },
      {
        wallet,
        tweet_id: "1780022222222222222",
        image_url: "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes: 320,
        retweets: 75,
        waldo_amount: 9.3,
        nftMinted: true
      },
  {
    wallet,
    tweet_id: "178001111555511111111",
    image_url: "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
    likes: 600,
    retweets: 120,
    waldo_amount: 10,
    nftMinted: false
  }
];

    return res.json(tweets);
  }

  try {
    const tweetIds = ["1780011111111111111", "1780022222222222222"]; // Placeholder list from DB or logic
    const tweets = [];

    for (const id of tweetIds) {
      const tweet = await twitterClient.v2.singleTweet(id, {
        "tweet.fields": "public_metrics,attachments",
        "expansions": "attachments.media_keys",
        "media.fields": "url"
      });

      const mediaUrl = tweet?.includes?.media?.[0]?.url;
      const likes = tweet?.data?.public_metrics?.like_count || 0;
      const retweets = tweet?.data?.public_metrics?.retweet_count || 0;
      const redisKey = `meme:nft_minted:${id}`;
      const isMinted = await redis.get(redisKey);

      tweets.push({
        wallet,
        tweet_id: id,
        image_url: mediaUrl || "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes,
        retweets,
        waldo_amount: 0,
        nftMinted: !!isMinted
      });
    }

    res.json(tweets);
  } catch (err) {
    console.error("❌ Failed to fetch tweets:", err);
    res.status(500).json({ error: "Failed to load tweet data." });
  }
});

export default router;


