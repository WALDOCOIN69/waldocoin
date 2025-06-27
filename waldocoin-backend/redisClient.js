// redisClient.js
import { createClient } from 'redis';

export const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: retries => {
      console.warn(`🔁 Redis reconnect attempt #${retries}`);
      return Math.min(retries * 100, 3000);
    },
    ...(process.env.REDIS_URL?.startsWith('rediss://')
      ? { tls: true, rejectUnauthorized: false }
      : {})
  }
});

export async function connectRedis() {
  redis.on('error', err => {
    console.error('❌ Redis Client Error:', err);
  });

  try {
    await redis.connect();
    console.log('✅ Redis connected');

    // 🔄 Keep-alive to prevent idle timeout
    setInterval(() => {
      redis.ping().catch(err => {
        console.warn('⚠️ Redis ping failed:', err.message);
      });
    }, 60 * 1000);
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
    process.exit(1);
  }
}
