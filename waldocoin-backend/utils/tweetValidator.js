import { redis } from "../redisClient.js";
import { TwitterApi } from "twitter-api-v2";

console.log("🧩 Loaded: utils/tweetValidator.js");

// Initialize Twitter client (if available)
let twitterClient = null;
try {
  if (process.env.TWITTER_BEARER_TOKEN) {
    twitterClient = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
  }
} catch (error) {
  console.log("⚠️ Twitter API not available for tweet validation");
}

/**
 * Validate tweet for battle participation
 * @param {string} tweetId - Tweet ID to validate
 * @param {string} userWallet - Wallet address of the user
 * @returns {Object} - { valid: boolean, reason: string, tweetData?: object }
 */
export async function validateTweetForBattle(tweetId, userWallet) {
  try {
    console.log(`🔍 Validating tweet ${tweetId} for wallet ${userWallet}`);

    // 1. Check if tweet ID is valid format
    if (!tweetId || !/^\d+$/.test(tweetId.toString())) {
      return {
        valid: false,
        reason: "Invalid tweet ID format"
      };
    }

    // 2. Check if tweet belongs to user's wallet in our system
    const userTweets = await redis.sMembers(`wallet:tweets:${userWallet}`);
    if (!userTweets.includes(tweetId)) {
      return {
        valid: false,
        reason: "Tweet not found in your meme collection. Make sure you've posted it with #WaldoMeme hashtag and it's been processed."
      };
    }

    // 3. Check if tweet exists in our meme database
    const memeData = await redis.hGetAll(`meme:${tweetId}`);
    if (!memeData || Object.keys(memeData).length === 0) {
      return {
        valid: false,
        reason: "Meme data not found. This tweet may not be properly processed yet."
      };
    }

    // 4. Check if tweet is already used in an active battle
    const isInActiveBattle = await isTweetInActiveBattle(tweetId);
    if (isInActiveBattle) {
      return {
        valid: false,
        reason: "This meme is already being used in an active battle. Please choose a different meme."
      };
    }

    // 5. Validate tweet content via Twitter API (if available)
    if (twitterClient) {
      try {
        const tweetResponse = await twitterClient.v2.singleTweet(tweetId, {
          "tweet.fields": "public_metrics,created_at,text",
          "expansions": "attachments.media_keys",
          "media.fields": "url,type"
        });

        if (!tweetResponse.data) {
          return {
            valid: false,
            reason: "Tweet not found or is private/deleted. Please use a public, accessible tweet."
          };
        }

        // Check if tweet has media
        const hasMedia = tweetResponse.includes?.media && tweetResponse.includes.media.length > 0;
        if (!hasMedia) {
          return {
            valid: false,
            reason: "Tweet must contain an image or video to be used in battles."
          };
        }

        // Check if tweet contains #WaldoMeme hashtag
        const tweetText = tweetResponse.data.text || "";
        if (!tweetText.toLowerCase().includes("#waldomeme")) {
          return {
            valid: false,
            reason: "Tweet must contain #WaldoMeme hashtag to be eligible for battles."
          };
        }

        return {
          valid: true,
          reason: "Tweet is valid for battle",
          tweetData: {
            id: tweetId,
            text: tweetText,
            mediaUrl: tweetResponse.includes?.media?.[0]?.url,
            likes: tweetResponse.data.public_metrics?.like_count || 0,
            retweets: tweetResponse.data.public_metrics?.retweet_count || 0,
            createdAt: tweetResponse.data.created_at
          }
        };

      } catch (twitterError) {
        console.log(`⚠️ Twitter API validation failed for ${tweetId}:`, twitterError.message);
        // Fall back to Redis-only validation if Twitter API fails
      }
    }

    // 6. Fallback validation using Redis data only
    const likes = parseInt(memeData.likes) || 0;
    const retweets = parseInt(memeData.retweets) || 0;
    const createdAt = memeData.created_at;

    return {
      valid: true,
      reason: "Tweet is valid for battle (validated via database)",
      tweetData: {
        id: tweetId,
        likes,
        retweets,
        createdAt,
        mediaUrl: memeData.image_url || null
      }
    };

  } catch (error) {
    console.error(`❌ Tweet validation error for ${tweetId}:`, error);
    return {
      valid: false,
      reason: "Unable to validate tweet. Please try again or contact support."
    };
  }
}

/**
 * Check if tweet is currently being used in an active battle
 * @param {string} tweetId - Tweet ID to check
 * @returns {boolean} - True if tweet is in active battle
 */
async function isTweetInActiveBattle(tweetId) {
  try {
    // Check all battle keys for active battles using this tweet
    const battleKeys = await redis.keys("battle:*:data");
    
    for (const key of battleKeys) {
      const battle = await redis.hGetAll(key);
      
      // Skip if battle is not active
      if (!battle || !["pending", "accepted"].includes(battle.status)) {
        continue;
      }
      
      // Check if this tweet is used as challenger or acceptor tweet
      if (battle.challengerTweetId === tweetId || battle.acceptorTweetId === tweetId) {
        console.log(`🔍 Tweet ${tweetId} found in active battle: ${key}`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error checking active battles for tweet ${tweetId}:`, error);
    return false; // Allow battle if we can't check (fail open)
  }
}

/**
 * Validate tweet ownership (check if tweet belongs to user's wallet)
 * @param {string} tweetId - Tweet ID to validate
 * @param {string} userWallet - User's wallet address
 * @returns {boolean} - True if tweet belongs to user
 */
export async function validateTweetOwnership(tweetId, userWallet) {
  try {
    const userTweets = await redis.sMembers(`wallet:tweets:${userWallet}`);
    return userTweets.includes(tweetId);
  } catch (error) {
    console.error(`❌ Error validating tweet ownership:`, error);
    return false;
  }
}

/**
 * Get tweet data for battle display
 * @param {string} tweetId - Tweet ID
 * @returns {Object} - Tweet data for frontend display
 */
export async function getTweetDataForBattle(tweetId) {
  try {
    const memeData = await redis.hGetAll(`meme:${tweetId}`);
    
    if (!memeData || Object.keys(memeData).length === 0) {
      return null;
    }
    
    return {
      id: tweetId,
      imageUrl: memeData.image_url || `https://waldocoin.live/wp-content/uploads/2025/07/waldobattle-1.png`,
      likes: parseInt(memeData.likes) || 0,
      retweets: parseInt(memeData.retweets) || 0,
      createdAt: memeData.created_at,
      text: memeData.text || ""
    };
  } catch (error) {
    console.error(`❌ Error getting tweet data for ${tweetId}:`, error);
    return null;
  }
}

/**
 * Batch validate multiple tweets (for admin/debugging)
 * @param {Array} tweetIds - Array of tweet IDs
 * @param {string} userWallet - User's wallet address
 * @returns {Array} - Array of validation results
 */
export async function batchValidateTweets(tweetIds, userWallet) {
  const results = [];
  
  for (const tweetId of tweetIds) {
    const validation = await validateTweetForBattle(tweetId, userWallet);
    results.push({
      tweetId,
      ...validation
    });
  }
  
  return results;
}
