// utils/scan_user.js - JavaScript version of Python scan_user
import fetch from 'node-fetch';
import { redis } from '../redisClient.js';

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

const HEADERS = {
  "Authorization": `Bearer ${BEARER_TOKEN}`,
  "User-Agent": "WaldoBot"
};

// XP calculation (matches Python version)
function calculateXp(likes, retweets) {
  return Math.floor(likes / 10) + Math.floor(retweets / 15);
}

// Reward calculation (matches Python version)
function calculateRewards(likes, retweets, rewardType = "instant") {
  const tiers = [
    { tier: 5, likes: 1000, retweets: 100, base: 50 },
    { tier: 4, likes: 500, retweets: 50, base: 25 },
    { tier: 3, likes: 100, retweets: 10, base: 5 },
    { tier: 2, likes: 50, retweets: 5, base: 2 },
    { tier: 1, likes: 25, retweets: 0, base: 1 },
  ];
  
  for (const t of tiers) {
    if (likes >= t.likes && retweets >= t.retweets) {
      const base = t.base;
      if (rewardType === "instant") {
        return { tier: t.tier, waldo: Math.round(base * 0.9 * 100) / 100 };
      } else {
        return { tier: t.tier, waldo: Math.round(base * 1.15 * 0.95 * 100) / 100 };
      }
    }
  }
  return { tier: 0, waldo: 0.0 };
}

// Store meme tweet (matches Python version)
async function storeMemetweet(tweet, handle, wallet) {
  const key = `meme:${tweet.id}`;
  
  // Check if already exists
  const exists = await redis.exists(key);
  if (exists) {
    return false;
  }

  const metrics = tweet.public_metrics;
  const xp = calculateXp(metrics.like_count, metrics.retweet_count);
  const { tier, waldo } = calculateRewards(metrics.like_count, metrics.retweet_count, "instant");

  // Store meme data
  await redis.hSet(key, {
    author_id: tweet.author_id,
    handle: handle,
    text: tweet.text,
    likes: metrics.like_count,
    retweets: metrics.retweet_count,
    created_at: tweet.created_at,
    wallet: wallet,
    tier: tier,
    waldo: waldo,
    xp: xp,
    claimed: 0,
    reward_type: "instant",
    stake_selected: 0,
    stake_release: ""
  });

  // Additional indexes
  await redis.sAdd(`wallet:tweets:${wallet}`, tweet.id);
  await redis.set(`meme:xp:${tweet.id}`, xp);
  await redis.set(`meme:waldo:${tweet.id}`, waldo);
  await redis.set(`meme:nft_minted:${tweet.id}`, "false");

  // XP tracking
  await redis.incrBy(`wallet:xp:${wallet}`, xp);
  
  // NFT eligibility (60+ XP threshold)
  if (xp >= 60) {
    await redis.set(`meme:nft_ready:${tweet.id}`, 1);
  }

  return true;
}

export async function scan_user(twitterHandle) {
  try {
    console.log(`🔍 Scanning tweets from @${twitterHandle}`);
    
    if (!BEARER_TOKEN) {
      console.error("❌ TWITTER_BEARER_TOKEN not found");
      return 0;
    }

    // Get wallet for this handle
    const wallet = await redis.get(`twitter:${twitterHandle.toLowerCase()}`);
    if (!wallet) {
      console.log(`❌ No wallet linked for @${twitterHandle}`);
      return 0;
    }

    // Get user ID first
    const userUrl = `https://api.twitter.com/2/users/by/username/${twitterHandle}`;
    const userResponse = await fetch(userUrl, { headers: HEADERS });
    
    if (!userResponse.ok) {
      console.error("❌ Error getting user ID:", userResponse.status);
      return 0;
    }

    const userData = await userResponse.json();
    const userId = userData.data.id;

    // Fetch recent tweets
    const tweetUrl = `https://api.twitter.com/2/users/${userId}/tweets?max_results=20&tweet.fields=public_metrics,created_at`;
    const tweetResponse = await fetch(tweetUrl, { headers: HEADERS });
    
    if (!tweetResponse.ok) {
      console.error("❌ Error fetching tweets:", tweetResponse.status);
      return 0;
    }

    const tweetData = await tweetResponse.json();
    const tweets = tweetData.data || [];
    
    let count = 0;
    for (const tweet of tweets) {
      // Check if tweet contains #waldomeme hashtag
      if (tweet.text.toLowerCase().includes("#waldomeme")) {
        tweet.author_id = userId; // Add author_id for consistency
        const stored = await storeMemetweet(tweet, twitterHandle, wallet);
        if (stored) {
          count++;
        }
      }
    }

    console.log(`✅ Found and stored ${count} memes for @${twitterHandle}`);
    return count;
    
  } catch (error) {
    console.error(`❌ Scan error for @${twitterHandle}:`, error.message);
    return 0;
  }
}
