// utils/wipeMemeKeys.js
import { redis } from '../redisClient.js'

export async function wipeMemeKeys(confirm = false) {
  if (!confirm) {
    console.warn('⚠️ wipeMemeKeys aborted — confirmation required.')
    console.warn('Usage: wipeMemeKeys(true) to confirm deletion.')
    return
  }

  const keys = await redis.keys('meme:*')

  if (keys.length === 0) {
    console.log('📭 No meme:* keys found in Redis.')
    return
  }

  const deleted = await redis.del(...keys)
  console.log(`🧹 Deleted ${deleted} meme:* keys from Redis.`)
}
