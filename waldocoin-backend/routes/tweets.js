// 📁 routes/tweets.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";
import { redis } from "../redisClient.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 🚫 REMOVE MOCK FLAG FOR PRODUCTION
const USE_FAKE_DATA = false;

const twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);

// 🐦 GET /tweets?wallet=...
router.get("/", async (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet not provided" });

  if (USE_FAKE_DATA) {
    return res.json([
      {
        wallet,
        tweet_id: "1780011111111111111",
        image_url: "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes: 180,
        retweets: 30,
        xp: 60,
        waldo_amount: 7.5,
        nftMinted: false
      }
    ]);
  }

  try {
    const tweetIds = await redis.sMembers(`wallet:tweets:${wallet}`);
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
      const xp = parseInt(await redis.get(`meme:xp:${id}`)) || 0;
      const waldo = parseFloat(await redis.get(`meme:waldo:${id}`)) || 0;
      const isMinted = !!(await redis.get(`meme:nft_minted:${id}`));

      tweets.push({
        wallet,
        tweet_id: id,
        image_url: mediaUrl || "https://waldocoin.live/wp-content/uploads/2025/04/waldo-placeholder.png",
        likes,
        retweets,
        xp,
        waldo_amount: waldo,
        nftMinted: isMinted
      });
    }

    res.json(tweets);
  } catch (err) {
    console.error("❌ Failed to fetch tweet data:", err);
    res.status(500).json({ error: "Failed to load tweet data." });
  }
});

export default router;
