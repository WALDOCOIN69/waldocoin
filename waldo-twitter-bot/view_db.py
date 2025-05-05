import os
import redis
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()
r = redis.from_url(os.getenv("REDIS_URL"))

def view_tweets(limit=50):
    keys = sorted(r.keys("meme:*"), reverse=True)
    if not keys:
        print("📭 No tweets found in Redis.")
        return

    print(f"📄 Displaying latest {min(limit, len(keys))} tweet(s):\n")

    for key in keys[:limit]:
        data = r.hgetall(key)
        tweet_id = key.decode().split(":")[1]
        author_id = data.get(b"author_id", b"?").decode()
        text = data.get(b"text", b"").decode().replace("\n", " ")
        likes = data.get(b"likes", b"0").decode()
        retweets = data.get(b"retweets", b"0").decode()
        created_at = data.get(b"created_at", b"?").decode()
        reward_type = data.get(b"reward_type", b"?").decode()
        claimed = data.get(b"claimed", b"0").decode()

        print(f"🧵 Tweet ID: {tweet_id}")
        print(f"👤 Author ID: {author_id}")
        print(f"💬 Text: {text[:200]}{'...' if len(text) > 200 else ''}")
        print(f"❤️ Likes: {likes}  🔁 Retweets: {retweets}")
        print(f"🎁 Reward Type: {reward_type}  ✅ Claimed: {claimed}")
        print(f"📅 Created At: {created_at}")
        print("-" * 40)

if __name__ == "__main__":
    view_tweets()
