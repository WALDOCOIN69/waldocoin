import cron from "node-cron";
import { processExpiredBattles } from "../utils/battleRefunds.js";

console.log("🧩 Loaded: cron/expiredBattleRefunder.js");

/**
 * Cron job to process expired battles every hour
 * Runs at minute 0 of every hour (e.g., 1:00, 2:00, 3:00, etc.)
 */
const expiredBattleRefunderJob = cron.schedule("0 * * * *", async () => {
  try {
    console.log("⏰ Running expired battle refund check...");
    const processedCount = await processExpiredBattles();
    
    if (processedCount > 0) {
      console.log(`✅ Expired battle refund job completed: ${processedCount} battles processed`);
    } else {
      console.log("✅ Expired battle refund job completed: No expired battles found");
    }
  } catch (error) {
    console.error("❌ Expired battle refund job failed:", error);
  }
}, {
  scheduled: false // Don't start automatically, will be started manually
});

/**
 * Start the expired battle refunder cron job
 */
export function startExpiredBattleRefunder() {
  console.log("🚀 Starting expired battle refunder cron job (runs every hour)");
  expiredBattleRefunderJob.start();
}

/**
 * Stop the expired battle refunder cron job
 */
export function stopExpiredBattleRefunder() {
  console.log("🛑 Stopping expired battle refunder cron job");
  expiredBattleRefunderJob.stop();
}

/**
 * Manual trigger for expired battle processing (for testing/admin use)
 */
export async function triggerExpiredBattleRefund() {
  console.log("🔧 Manually triggering expired battle refund...");
  try {
    const processedCount = await processExpiredBattles();
    console.log(`✅ Manual expired battle refund completed: ${processedCount} battles processed`);
    return processedCount;
  } catch (error) {
    console.error("❌ Manual expired battle refund failed:", error);
    throw error;
  }
}

// Export the cron job for external control
export { expiredBattleRefunderJob };

// If this file is run directly (for testing)
if (process.argv[1] === (new URL(import.meta.url)).pathname) {
  console.log("🧪 Running expired battle refund manually...");
  triggerExpiredBattleRefund()
    .then((count) => {
      console.log(`✅ Manual run completed: ${count} battles processed`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Manual run failed:", error);
      process.exit(1);
    });
}
