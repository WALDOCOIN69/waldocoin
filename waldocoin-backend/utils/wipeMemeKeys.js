// utils/wipeMemeKeys.js
import { redis } from "../redisClient.js";

export async function wipeMemeKeys() {
  const keys = await redis.keys("meme:*");
  if (keys.length === 0) {
    console.log("📭 No meme:* keys to delete.");
    return;
  }

  const deleted = await redis.del(...keys);
  console.log(`🧹 Deleted ${deleted} meme:* keys from Redis.`);
}
