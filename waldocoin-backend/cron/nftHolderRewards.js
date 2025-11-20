import cron from "node-cron";
import { distributeHolderRewards } from "../utils/nftUtilities.js";
import { redis } from "../redisClient.js";

console.log("🧩 Loaded: cron/nftHolderRewards.js");

/**
 * Distribute NFT holder rewards from the reward pool
 * Only holders with 3+ NFTs (Gold tier and above) receive rewards
 */
async function distributeMonthlyRewards() {
  try {
    console.log("💎 Starting monthly NFT holder reward distribution...");
    
    // Check pool balance
    const poolAmount = parseFloat(await redis.get('nft:holder_reward_pool')) || 0;
    console.log(`💰 Current reward pool: ${poolAmount.toFixed(2)} WALDO`);
    
    if (poolAmount < 100) {
      console.log(`⚠️ Pool too small to distribute (${poolAmount.toFixed(2)} WALDO). Minimum: 100 WALDO`);
      return { success: false, reason: 'pool_too_small', poolAmount };
    }
    
    // Distribute rewards
    const result = await distributeHolderRewards();
    
    if (result.success) {
      console.log(`✅ NFT holder rewards distributed: ${result.totalDistributed.toFixed(2)} WALDO to ${result.holders} holders`);
      
      // Log distribution event
      await redis.lpush('nft:distribution_log', JSON.stringify({
        timestamp: new Date().toISOString(),
        totalDistributed: result.totalDistributed,
        holders: result.holders,
        success: true
      }));
      await redis.ltrim('nft:distribution_log', 0, 99); // Keep last 100 distributions
      
      return result;
    } else {
      console.error(`❌ NFT holder reward distribution failed: ${result.error}`);
      return result;
    }
  } catch (error) {
    console.error("❌ Error in distributeMonthlyRewards:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Cron job to distribute NFT holder rewards on the 1st of each month at 00:00 UTC
 * Schedule: "0 0 1 * *" = At 00:00 on day-of-month 1
 */
const nftRewardsJob = cron.schedule("0 0 1 * *", async () => {
  try {
    console.log("⏰ Running monthly NFT holder reward distribution...");
    const result = await distributeMonthlyRewards();
    
    if (result.success) {
      console.log(`✅ Monthly NFT reward distribution completed: ${result.totalDistributed.toFixed(2)} WALDO distributed`);
    } else {
      console.log(`⚠️ Monthly NFT reward distribution skipped: ${result.reason || result.error}`);
    }
  } catch (error) {
    console.error("❌ Monthly NFT reward distribution job failed:", error);
  }
}, {
  scheduled: false, // Don't start automatically, will be started manually
  timezone: "UTC"
});

/**
 * Start the NFT holder rewards cron job
 */
export function startNFTHolderRewards() {
  console.log("🚀 Starting NFT holder rewards cron job (runs 1st of each month at 00:00 UTC)");
  nftRewardsJob.start();
}

/**
 * Stop the NFT holder rewards cron job
 */
export function stopNFTHolderRewards() {
  console.log("🛑 Stopping NFT holder rewards cron job");
  nftRewardsJob.stop();
}

/**
 * Manually trigger distribution (for testing or admin use)
 */
export async function triggerDistribution() {
  console.log("🎁 Manually triggering NFT holder reward distribution...");
  return await distributeMonthlyRewards();
}

export { distributeMonthlyRewards };

