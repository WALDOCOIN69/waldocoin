import express from "express";
import { redis } from "../redisClient.js";
import {
  getHolderTier,
  applyHolderXPBoost,
  applyClaimFeeDiscount,
  addToHolderRewardPool,
  distributeHolderRewards,
  canAccessHolderBattle,
  getHolderBattleDiscount,
  getStakingBoost,
  getTopNFTHolders,
  getNFTVotingPower,
  getMonthlyPerks,
  claimMonthlyPerks,
  trackNFTUtilityUsage
} from "../utils/nftUtilities.js";

const router = express.Router();

// ============================================================================
// 1️⃣ GET HOLDER TIER & BENEFITS
// ============================================================================

router.get("/holder-tier/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const tier = await getHolderTier(wallet);
    const nftCount = parseInt(await redis.get(`wallet:nft_count:${wallet}`)) || 0;
    const votingPower = await getNFTVotingPower(wallet);
    const stakingBoost = await getStakingBoost(wallet);
    const battleDiscount = await getHolderBattleDiscount(wallet);

    res.json({
      success: true,
      wallet: wallet.substring(0, 10) + "..." + wallet.substring(wallet.length - 6),
      nftCount,
      tier: tier.name,
      tierLevel: tier.tier,
      benefits: {
        xpBoost: `+${tier.xpBoost * 100}%`,
        claimFeeDiscount: `${tier.claimFeeDiscount * 100}%`,
        rewardShares: tier.shares,
        votingPower: `${(votingPower * 100).toFixed(0)}%`,
        stakingBoost: `+${(stakingBoost * 100).toFixed(1)}% APY`,
        battleDiscount: `${(battleDiscount * 100).toFixed(0)}% off`
      }
    });
  } catch (error) {
    console.error("❌ Error getting holder tier:", error);
    res.status(500).json({ success: false, error: "Failed to get holder tier" });
  }
});

// ============================================================================
// 2️⃣ APPLY XP BOOST
// ============================================================================

router.post("/apply-xp-boost", async (req, res) => {
  try {
    const { wallet, baseXP } = req.body;

    if (!wallet || !baseXP) {
      return res.status(400).json({ success: false, error: "Missing wallet or baseXP" });
    }

    const result = await applyHolderXPBoost(wallet, baseXP);
    await trackNFTUtilityUsage(wallet, "xp_boost");

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("❌ Error applying XP boost:", error);
    res.status(500).json({ success: false, error: "Failed to apply XP boost" });
  }
});

// ============================================================================
// 3️⃣ APPLY CLAIM FEE DISCOUNT
// ============================================================================

router.post("/apply-fee-discount", async (req, res) => {
  try {
    const { wallet, baseFee } = req.body;

    if (!wallet || baseFee === undefined) {
      return res.status(400).json({ success: false, error: "Missing wallet or baseFee" });
    }

    const result = await applyClaimFeeDiscount(wallet, baseFee);
    await trackNFTUtilityUsage(wallet, "fee_discount");

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("❌ Error applying fee discount:", error);
    res.status(500).json({ success: false, error: "Failed to apply fee discount" });
  }
});

// ============================================================================
// 4️⃣ GET HOLDER REWARD POOL STATUS
// ============================================================================

router.get("/reward-pool", async (req, res) => {
  try {
    const poolAmount = parseFloat(await redis.get("nft:holder_reward_pool")) || 0;
    const month = new Date().toISOString().slice(0, 7);
    const monthlyAmount = parseFloat(await redis.get(`nft:holder_reward_pool:${month}`)) || 0;

    res.json({
      success: true,
      currentPool: poolAmount,
      monthlyAccumulated: monthlyAmount,
      month,
      nextDistribution: "1st of next month"
    });
  } catch (error) {
    console.error("❌ Error getting reward pool:", error);
    res.status(500).json({ success: false, error: "Failed to get reward pool" });
  }
});

// ============================================================================
// 5️⃣ CHECK BATTLE ACCESS
// ============================================================================

router.get("/battle-access/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const hasAccess = await canAccessHolderBattle(wallet);
    const discount = await getHolderBattleDiscount(wallet);

    res.json({
      success: true,
      hasAccess,
      discount: `${(discount * 100).toFixed(0)}% off`,
      message: hasAccess ? "✅ Access to Holder Battles" : "❌ Need 1+ NFT for access"
    });
  } catch (error) {
    console.error("❌ Error checking battle access:", error);
    res.status(500).json({ success: false, error: "Failed to check battle access" });
  }
});

// ============================================================================
// 6️⃣ GET TOP NFT HOLDERS LEADERBOARD
// ============================================================================

router.get("/leaderboard", async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const leaderboard = await getTopNFTHolders(parseInt(limit));

    res.json({
      success: true,
      leaderboard,
      totalHolders: leaderboard.length,
      rewards: {
        first: "500 WALDO + Hall of Fame",
        second: "300 WALDO + Elite Badge",
        third: "200 WALDO + VIP Badge"
      }
    });
  } catch (error) {
    console.error("❌ Error getting leaderboard:", error);
    res.status(500).json({ success: false, error: "Failed to get leaderboard" });
  }
});

// ============================================================================
// 7️⃣ GET MONTHLY PERKS
// ============================================================================

router.get("/monthly-perks/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const perks = await getMonthlyPerks(wallet);
    await trackNFTUtilityUsage(wallet, "view_perks");

    res.json({ success: true, ...perks });
  } catch (error) {
    console.error("❌ Error getting monthly perks:", error);
    res.status(500).json({ success: false, error: "Failed to get monthly perks" });
  }
});

// ============================================================================
// 8️⃣ CLAIM MONTHLY PERKS
// ============================================================================

router.post("/claim-monthly-perks", async (req, res) => {
  try {
    const { wallet } = req.body;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const result = await claimMonthlyPerks(wallet);
    if (result.success) {
      await trackNFTUtilityUsage(wallet, "claim_perks");
    }

    res.json(result);
  } catch (error) {
    console.error("❌ Error claiming perks:", error);
    res.status(500).json({ success: false, error: "Failed to claim perks" });
  }
});

// ============================================================================
// 9️⃣ GET DAO VOTING POWER
// ============================================================================

router.get("/voting-power/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const votingPower = await getNFTVotingPower(wallet);
    const tier = await getHolderTier(wallet);

    res.json({
      success: true,
      wallet: wallet.substring(0, 10) + "..." + wallet.substring(wallet.length - 6),
      tier: tier.name,
      votingPower: `${(votingPower * 100).toFixed(0)}%`,
      multiplier: votingPower,
      message: votingPower > 1 ? `✅ ${(votingPower * 100).toFixed(0)}% voting boost` : "⚪ Standard voting power"
    });
  } catch (error) {
    console.error("❌ Error getting voting power:", error);
    res.status(500).json({ success: false, error: "Failed to get voting power" });
  }
});

// ============================================================================
// 🔟 GET STAKING BOOST
// ============================================================================

router.get("/staking-boost/:wallet", async (req, res) => {
  try {
    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet" });
    }

    const boost = await getStakingBoost(wallet);
    const tier = await getHolderTier(wallet);

    res.json({
      success: true,
      wallet: wallet.substring(0, 10) + "..." + wallet.substring(wallet.length - 6),
      tier: tier.name,
      apyBoost: `+${(boost * 100).toFixed(1)}%`,
      example: {
        baseAPY: "10%",
        withBoost: `${(10 + boost * 100).toFixed(1)}%`,
        yearlyGain: `+${(boost * 1000).toFixed(0)} WALDO on 10k stake`
      }
    });
  } catch (error) {
    console.error("❌ Error getting staking boost:", error);
    res.status(500).json({ success: false, error: "Failed to get staking boost" });
  }
});

// ============================================================================
// ADMIN: DISTRIBUTE HOLDER REWARDS
// ============================================================================

router.post("/admin/distribute-rewards", async (req, res) => {
  try {
    const { adminKey } = req.body;

    // Simple admin check (in production, use proper auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const result = await distributeHolderRewards();
    res.json(result);
  } catch (error) {
    console.error("❌ Error distributing rewards:", error);
    res.status(500).json({ success: false, error: "Failed to distribute rewards" });
  }
});

// ============================================================================
// ADMIN: ADD TO REWARD POOL
// ============================================================================

router.post("/admin/add-to-pool", async (req, res) => {
  try {
    const { adminKey, amount } = req.body;

    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid amount" });
    }

    const result = await addToHolderRewardPool(amount);
    res.json(result);
  } catch (error) {
    console.error("❌ Error adding to pool:", error);
    res.status(500).json({ success: false, error: "Failed to add to pool" });
  }
});

export default router;

