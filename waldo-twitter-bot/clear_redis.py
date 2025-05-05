import redis
import os
from dotenv import load_dotenv

load_dotenv()

redis_url = os.getenv("REDIS_URL")
if not redis_url:
    print("❌ REDIS_URL not found in environment variables.")
    exit(1)

r = redis.from_url(redis_url)
keys_deleted = 0

for key in r.scan_iter("meme:*"):
    r.delete(key)
    print(f"🗑️ Deleted {key.decode()}")
    keys_deleted += 1

if keys_deleted == 0:
    print("📭 No meme:* keys found in Redis.")
else:
    print(f"✅ Deleted {keys_deleted} key(s).")

