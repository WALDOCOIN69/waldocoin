import { redis, connectRedis } from "../redisClient.js";

// Ensure Redis is connected for test scripts
await connectRedis();

export { redis };

