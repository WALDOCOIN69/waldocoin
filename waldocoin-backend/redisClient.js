// redisClient.js
import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379"
});

redis.on("error", (err) => {
  console.error("❌ Redis Client Error", err);
});

// Only connect once (manually from server.js)
async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
    console.log("✅ Redis connected");
  }
}

export { redis, connectRedis };
