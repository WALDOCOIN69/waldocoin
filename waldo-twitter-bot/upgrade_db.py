import os
from dotenv import load_dotenv
import redis

load_dotenv()

# Connect to Redis using the .env REDIS_URL
r = redis.from_url(os.getenv("REDIS_URL"))

def recalculate_tier(likes, retweets, reward_type):
    tiers = [
        {"tier": 5, "likes": 1000, "retweets": 100, "base": 50},
        {"tier": 4, "likes": 500, "retweets": 50, "base": 25},
        {"tier": 3, "likes": 100, "retweets": 10, "base": 5},
        {"tier": 2, "likes": 50, "retweets": 5, "base": 2},
        {"tier": 1, "likes": 25, "retweets": 0, "base": 1},
    ]
    for t in tiers:
        if likes >= t["likes"] and retweets >= t["retweets"]:
            base = t["base"]
            if reward_type == "instant":
                waldo = round(base * 0.9, 2)
            else:
                waldo = round(base * 1.15 * 0.95, 2)
            return t["tier"], waldo
    return 0, 0.0

def upgrade_all():
    keys = r.keys("meme:*")
    updated = 0

    for key in keys:
        data = r.hgetall(key)
        try:
            likes = int(data.get(b"likes", b"0"))
            retweets = int(data.get(b"retweets", b"0"))
            reward_type = data.get(b"reward_type", b"stake").decode()

            tier, waldo = recalculate_tier(likes, retweets, reward_type)

            r.hset(key, mapping={
                "reward_tier": tier,
                "waldo_amount": waldo
            })

            updated += 1
        except Exception as e:
            print(f"❌ Error on {key.decode()}: {e}")

    print(f"\n✅ Upgrade complete. Updated {updated} meme entries.")

if __name__ == "__main__":
    upgrade_all()

