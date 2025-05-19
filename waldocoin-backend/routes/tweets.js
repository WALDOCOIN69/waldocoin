import express from "express";
import { TwitterApi } from "twitter-api-v2";

const router = express.Router();
const twitterClient = new TwitterApi(process.env.TWITTER_BEARER);

// Set to true for dummy data (optional)
const USE_FAKE_DATA = false;

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
        waldo_amount: 4.5
      },
      {
        wallet,
        tweet_id: "1780022222222222222",
        image_url: "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes: 320,
        retweets: 75,
        waldo_amount: 9.3
      }
    ];
    return res.json(tweets);
  }

  try {
    const tweetIds = ["1780011111111111111", "1780022222222222222"]; // Placeholder list
    const tweets = [];

    for (const id of tweetIds) {
      const tweet = await twitterClient.v2.singleTweet(id, {
        "tweet.fields": "public_metrics,attachments",
        "expansions": "attachments.media_keys",
        "media.fields": "url"
      });

      const mediaUrl = tweet?.includes?.media?.[0]?.url;

      tweets.push({
        wallet,
        tweet_id: id,
        image_url: mediaUrl || "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes: tweet?.data?.public_metrics?.like_count || 0,
        retweets: tweet?.data?.public_metrics?.retweet_count || 0,
        waldo_amount: 0
      });
    }

    res.json(tweets);
  } catch (err) {
    console.error("❌ Failed to fetch tweets:", err);
    res.status(500).json({ error: "Failed to load tweet data." });
  }
});

export default router;


