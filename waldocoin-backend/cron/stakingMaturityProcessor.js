import cron from "node-cron";
import { redis } from "../redisClient.js";

console.log("🧩 Loaded: cron/stakingMaturityProcessor.js");

/**
 * Process mature staking positions automatically
 * Checks for stakes that have matured and marks them as ready for redemption
 */
async function processMatureStakes() {
  try {
    const now = new Date();
    const stakingKeys = await redis.keys("staking:longterm_*");
    
    let processedCount = 0;
    let matureCount = 0;

    for (const key of stakingKeys) {
      try {
        const stakeData = await redis.hGetAll(key);
        
        if (!stakeData || !stakeData.wallet) continue;
        
        // Skip if already processed
        if (stakeData.status === 'redeemed' || stakeData.status === 'paid_out' || stakeData.status === 'completed') {
          continue;
        }

        const endDate = new Date(stakeData.endDate || stakeData.endTime);
        
        if (isNaN(endDate.getTime())) {
          console.warn(`⚠️ Invalid end date for ${key}: ${stakeData.endDate}`);
          continue;
        }

        // Check if mature (with 60 second buffer)
        const bufferMs = 60 * 1000;
        const timeRemaining = endDate - now;

        if (timeRemaining <= bufferMs && stakeData.status === 'active') {
          console.log(`✅ Stake matured: ${key} (${stakeData.wallet})`);
          
          // Mark as mature/ready for redemption
          await redis.hSet(key, {
            status: 'mature',
            matureAt: now.toISOString()
          });
          
          matureCount++;
        }

        processedCount++;
      } catch (err) {
        console.error(`❌ Error processing stake ${key}:`, err.message);
      }
    }

    if (matureCount > 0) {
      console.log(`🏦 Staking maturity check: ${matureCount} stakes matured, ${processedCount} total processed`);
    }

    return { processedCount, matureCount };
  } catch (error) {
    console.error("❌ Error in processMatureStakes:", error);
    return { processedCount: 0, matureCount: 0 };
  }
}

/**
 * Cron job to process mature stakes every 5 minutes
 */
const stakingMaturityJob = cron.schedule("*/5 * * * *", async () => {
  try {
    console.log("⏰ Running staking maturity check...");
    const result = await processMatureStakes();
    
    if (result.matureCount > 0) {
      console.log(`✅ Staking maturity job completed: ${result.matureCount} stakes matured`);
    }
  } catch (error) {
    console.error("❌ Staking maturity job failed:", error);
  }
}, {
  scheduled: false // Don't start automatically, will be started manually
});

/**
 * Start the staking maturity processor cron job
 */
export function startStakingMaturityProcessor() {
  console.log("🚀 Starting staking maturity processor cron job (runs every 5 minutes)");
  stakingMaturityJob.start();
}

/**
 * Stop the staking maturity processor cron job
 */
export function stopStakingMaturityProcessor() {
  console.log("🛑 Stopping staking maturity processor cron job");
  stakingMaturityJob.stop();
}

export { processMatureStakes };

