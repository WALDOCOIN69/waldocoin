/**
 * Clear all Twitter/X linking data from Redis
 *
 * This script removes:
 * - twitterHandle field from all user:{wallet} hashes
 * - twitter:{handle} keys
 * - wallet:handle:{wallet} keys
 *
 * Run with: node scripts/clearTwitterData.js
 */

import { redis, connectRedis } from "../redisClient.js";

async function clearTwitterData() {
  console.log("🧹 Starting Twitter data cleanup...\n");

  // Connect to Redis first
  console.log("🔌 Connecting to Redis...");
  await connectRedis();
  console.log("✅ Connected!\n");

  let twitterKeysDeleted = 0;
  let walletHandleKeysDeleted = 0;
  let userTwitterFieldsCleared = 0;

  try {
    // 1. Delete all twitter:{handle} keys
    console.log("1️⃣ Finding twitter:* keys...");
    const twitterKeys = await redis.keys("twitter:*");
    console.log(`   Found ${twitterKeys.length} twitter:* keys`);

    for (const key of twitterKeys) {
      await redis.del(key);
      console.log(`   Deleted: ${key}`);
      twitterKeysDeleted++;
    }
    console.log(`   ✅ Deleted ${twitterKeysDeleted} twitter:* keys\n`);

    // 2. Delete all wallet:handle:{wallet} keys
    console.log("2️⃣ Finding wallet:handle:* keys...");
    const walletHandleKeys = await redis.keys("wallet:handle:*");
    console.log(`   Found ${walletHandleKeys.length} wallet:handle:* keys`);

    for (const key of walletHandleKeys) {
      await redis.del(key);
      console.log(`   Deleted: ${key}`);
      walletHandleKeysDeleted++;
    }
    console.log(`   ✅ Deleted ${walletHandleKeysDeleted} wallet:handle:* keys\n`);

    // 3. Clear twitterHandle field from all user:{wallet} hashes
    console.log("3️⃣ Finding user:* keys to clear twitterHandle field...");
    const userKeys = await redis.keys("user:*");
    console.log(`   Found ${userKeys.length} user:* keys`);

    for (const key of userKeys) {
      // Only process user:{wallet} format (exactly 2 parts)
      if (key.split(':').length === 2) {
        try {
          const hasTwitterHandle = await redis.hExists(key, "twitterHandle");
          if (hasTwitterHandle) {
            await redis.hDel(key, "twitterHandle");
            console.log(`   Cleared twitterHandle from: ${key}`);
            userTwitterFieldsCleared++;
          }
        } catch (e) {
          // Key might not be a hash
        }
      }
    }
    console.log(`   ✅ Cleared twitterHandle from ${userTwitterFieldsCleared} user records\n`);

    // Summary
    console.log("═══════════════════════════════════════");
    console.log("🎉 Twitter Data Cleanup Complete!");
    console.log("═══════════════════════════════════════");
    console.log(`   twitter:* keys deleted: ${twitterKeysDeleted}`);
    console.log(`   wallet:handle:* keys deleted: ${walletHandleKeysDeleted}`);
    console.log(`   user twitterHandle fields cleared: ${userTwitterFieldsCleared}`);
    console.log("\n✅ All users can now link their X accounts fresh!");

  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    process.exit(1);
  }

  // Close Redis connection
  await redis.quit();
  process.exit(0);
}

clearTwitterData();

