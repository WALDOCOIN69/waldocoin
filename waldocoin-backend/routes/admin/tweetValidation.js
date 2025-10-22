import express from "express";
import { validateTweetForBattle, validateTweetOwnership, getTweetDataForBattle, batchValidateTweets } from "../../utils/tweetValidator.js";

const router = express.Router();

console.log("🧩 Loaded: routes/admin/tweetValidation.js");

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }
  next();
};

// POST /api/admin/tweet-validation/validate - Validate a single tweet for battle
router.post("/validate", requireAdmin, async (req, res) => {
  try {
    const { tweetId, userWallet } = req.body;
    
    if (!tweetId || !userWallet) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: tweetId, userWallet"
      });
    }
    
    console.log(`🔧 Admin validating tweet ${tweetId} for wallet ${userWallet}`);
    const validation = await validateTweetForBattle(tweetId, userWallet);
    
    return res.json({
      success: true,
      tweetId,
      userWallet,
      validation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin tweet validation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to validate tweet",
      detail: error.message
    });
  }
});

// POST /api/admin/tweet-validation/batch - Batch validate multiple tweets
router.post("/batch", requireAdmin, async (req, res) => {
  try {
    const { tweetIds, userWallet } = req.body;
    
    if (!Array.isArray(tweetIds) || !userWallet) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: tweetIds (array), userWallet"
      });
    }
    
    console.log(`🔧 Admin batch validating ${tweetIds.length} tweets for wallet ${userWallet}`);
    const results = await batchValidateTweets(tweetIds, userWallet);
    
    const summary = {
      total: results.length,
      valid: results.filter(r => r.valid).length,
      invalid: results.filter(r => !r.valid).length
    };
    
    return res.json({
      success: true,
      userWallet,
      summary,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin batch tweet validation failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to batch validate tweets",
      detail: error.message
    });
  }
});

// GET /api/admin/tweet-validation/ownership/:tweetId/:wallet - Check tweet ownership
router.get("/ownership/:tweetId/:wallet", requireAdmin, async (req, res) => {
  try {
    const { tweetId, wallet } = req.params;
    
    console.log(`🔧 Admin checking ownership of tweet ${tweetId} for wallet ${wallet}`);
    const isOwner = await validateTweetOwnership(tweetId, wallet);
    
    return res.json({
      success: true,
      tweetId,
      wallet,
      isOwner,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin tweet ownership check failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check tweet ownership",
      detail: error.message
    });
  }
});

// GET /api/admin/tweet-validation/data/:tweetId - Get tweet data for battle
router.get("/data/:tweetId", requireAdmin, async (req, res) => {
  try {
    const { tweetId } = req.params;
    
    console.log(`🔧 Admin getting tweet data for ${tweetId}`);
    const tweetData = await getTweetDataForBattle(tweetId);
    
    if (!tweetData) {
      return res.status(404).json({
        success: false,
        error: "Tweet data not found"
      });
    }
    
    return res.json({
      success: true,
      tweetId,
      tweetData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin tweet data retrieval failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get tweet data",
      detail: error.message
    });
  }
});

// POST /api/admin/tweet-validation/test-user - Test all tweets for a user
router.post("/test-user", requireAdmin, async (req, res) => {
  try {
    const { userWallet } = req.body;
    
    if (!userWallet) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: userWallet"
      });
    }
    
    console.log(`🔧 Admin testing all tweets for wallet ${userWallet}`);
    
    // Get all user's tweets
    const { redis } = await import("../../redisClient.js");
    const userTweets = await redis.sMembers(`wallet:tweets:${userWallet}`);
    
    if (userTweets.length === 0) {
      return res.json({
        success: true,
        userWallet,
        message: "No tweets found for this wallet",
        results: [],
        summary: { total: 0, valid: 0, invalid: 0 }
      });
    }
    
    const results = await batchValidateTweets(userTweets, userWallet);
    
    const summary = {
      total: results.length,
      valid: results.filter(r => r.valid).length,
      invalid: results.filter(r => !r.valid).length,
      validTweets: results.filter(r => r.valid).map(r => r.tweetId),
      invalidTweets: results.filter(r => !r.valid).map(r => ({ tweetId: r.tweetId, reason: r.reason }))
    };
    
    return res.json({
      success: true,
      userWallet,
      summary,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin user tweet test failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to test user tweets",
      detail: error.message
    });
  }
});

export default router;
