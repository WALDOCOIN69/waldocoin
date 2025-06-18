import { createClient } from 'redis'

export const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: retries => {
      console.warn(`🔁 Redis reconnect attempt #${retries}`)
      return Math.min(retries * 100, 3000) // max 3s backoff
    },
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined
  }
})

export async function connectRedis() {
  redis.on('error', err => {
    console.error('❌ Redis Client Error:', err)
  })

  try {
    await redis.connect()
    console.log('✅ Redis connected')

    // 🔄 Keep-alive to prevent Render idle disconnect
    setInterval(() => {
      redis.ping().catch(err => {
        console.warn('⚠️ Redis ping failed:', err.message)
      })
    }, 60 * 1000) // every 1 minute

  } catch (err) {
    console.error('❌ Redis connection failed:', err)
    process.exit(1)
  }
}
