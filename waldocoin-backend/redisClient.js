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

let _errorHandlerAttached = false;
let _connecting = null;
let _connected = false;

export async function connectRedis() {
  try {
    if (!_errorHandlerAttached) {
      redis.on('error', err => {
        console.error('❌ Redis Client Error:', err);
      });
      _errorHandlerAttached = true;
    }

    // If already open/ready, do nothing
    if (redis.isOpen || redis.isReady || _connected) return;

    // If a connection attempt is already in-flight, await it
    if (_connecting) { await _connecting; return; }

    _connecting = redis.connect();
    await _connecting;
    _connected = true;
    console.log('✅ Redis connected');

    // 🧹 REMOVED PING INTERVAL — not needed for Upstash (serverless)
    // It was causing ETIMEDOUT errors because Upstash sleeps idle connections
  } catch (err) {
    const msg = err?.message || String(err);
    if (/already\s*open/i.test(msg) || /Socket already opened/i.test(msg)) {
      // Harmless if called twice — treat as connected
      _connected = true;
      console.warn('⚠️ Redis connect called but socket already open. Continuing.');
      return;
    }
    console.error('❌ Redis connection failed:', err);
    throw err;
  } finally {
    _connecting = null;
  }
}
