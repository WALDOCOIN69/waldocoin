# scan_user.py
import os
import requests
import redis
from dotenv import load_dotenv

load_dotenv()
r = redis.from_url(os.getenv("REDIS_URL"))
BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN")

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "User-Agent": "WaldoBot"
}

def scan_user(twitter_handle):
    try:
        print(f"🔍 Scanning tweets from @{twitter_handle}")
        # Get user ID first
        url_user = f"https://api.twitter.com/2/users/by/username/{twitter_handle}"
        res = requests.get(url_user, headers=HEADERS)
        if res.status_code != 200:
            print("❌ Error getting user ID")
            return 0

        user_id = res.json()["data"]["id"]

        # Then fetch recent tweets
        tweet_url = f"https://api.twitter.com/2/users/{user_id}/tweets?max_results=20&tweet.fields=public_metrics,created_at"
        res = requests.get(tweet_url, headers=HEADERS)
        if res.status_code != 200:
            print("❌ Error fetching tweets")
            return 0

        from main import store_meme_tweet  # or wherever store_meme_tweet is defined

        tweets = res.json().get("data", [])
        count = 0
        for t in tweets:
            if "#waldomeme" in t["text"].lower():
                t["author_id"] = user_id
                stored = store_meme_tweet(t)
                if stored:
                    count += 1

        print(f"✅ Found and stored {count} memes for @{twitter_handle}")
        return count
    except Exception as e:
        print(f"❌ Scan error: {e}")
        return 0
