import os
import uuid
import requests
import asyncio
import redis
import threading
import time
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify
from flask_cors import CORS
from flask_limiter.util import get_remote_address
from flask_limiter import Limiter
from dotenv import load_dotenv
from xrpl.clients import JsonRpcClient
from xrpl.wallet import Wallet
from xrpl.models.transactions import Payment
from xrpl.asyncio.transaction import autofill_and_sign, submit_and_wait

# === Load .env ===
load_dotenv()
LIVE_MODE = os.getenv("LIVE_MODE", "false").lower() == "true"
USE_MOCK_DATA = False
# NFT_XP_THRESHOLD removed - whitepaper doesn't specify XP requirement for NFT minting
DEFAULT_REWARD_TYPE = "instant"

# === Setup Flask + Redis ===
app = Flask(__name__)
CORS(app)
r = redis.from_url(os.getenv("REDIS_URL"))
limiter = Limiter(get_remote_address, app=app, storage_uri=os.getenv("REDIS_URL"), default_limits=["20 per minute"])

# === Config ===
PORT = int(os.getenv("PORT", 5050))
XRPL_NODE = os.getenv("XRPL_NODE", "https://s.altnet.rippletest.net:51234")
DISTRIBUTOR_SECRET = os.getenv("DISTRIBUTOR_SECRET")
WALDO_ISSUER = os.getenv("WALDO_ISSUER")
BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN")

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "User-Agent": "WaldoBot"
}

# Twitter search
QUERY = "#WaldoMeme -is:retweet"
TWEET_FIELDS = "author_id,public_metrics,created_at"
MAX_RESULTS = 50
URL = f"https://api.twitter.com/2/tweets/search/recent?query={QUERY}&tweet.fields={TWEET_FIELDS}&max_results={MAX_RESULTS}"

# === Helper functions ===
def get_month_end():
    now = datetime.now(timezone.utc)
    next_month = now.replace(day=28) + timedelta(days=4)
    return next_month.replace(day=1) - timedelta(seconds=1)

def calculate_xp(likes, retweets):
    """Calculate XP based on engagement (1 XP per 25 likes, 1 XP per 15 retweets, max 10 XP per meme)"""
    xp_from_likes = likes // 25
    xp_from_retweets = retweets // 15
    total_xp = xp_from_likes + xp_from_retweets

    # Cap at 10 XP per meme as per whitepaper
    return min(total_xp, 10)

def calculate_rewards(likes, retweets, reward_type):
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
                return t["tier"], round(base * 0.9, 2)
            else:
                return t["tier"], round(base * 1.15 * 0.95, 2)
    return 0, 0.0

def fetch_author_handle(user_id):
    cache_key = f"twitter_id:{user_id}"
    cached = r.get(cache_key)
    if cached:
        return cached.decode()
    url = f"https://api.twitter.com/2/users/{user_id}"
    res = requests.get(url, headers=HEADERS)
    if res.status_code != 200:
        return None
    username = res.json().get("data", {}).get("username")
    if username:
        r.set(cache_key, username, ex=86400)
    return username

def check_daily_meme_limit(handle, wallet):
    """Check if user has exceeded their daily meme limit"""
    try:
        # Get user's WALDO balance to determine tier
        user_data = r.hgetall(f"user:{wallet}")
        waldo_balance = int(user_data.get(b'waldoBalance', 0)) if user_data.get(b'waldoBalance') else 0

        # Determine daily limit based on WALDO holdings
        if waldo_balance >= 50000:  # VIP tier
            daily_limit = int(r.get("limits:meme_vip") or 50)
            tier = "VIP"
        elif waldo_balance >= 10000:  # Premium tier
            daily_limit = int(r.get("limits:meme_premium") or 25)
            tier = "Premium"
        else:  # Standard tier
            daily_limit = int(r.get("limits:meme_daily") or 10)
            tier = "Standard"

        # Get today's date for tracking
        today = datetime.now().strftime('%Y-%m-%d')
        daily_key = f"meme_count:{handle}:{today}"

        # Get current count for today
        current_count = int(r.get(daily_key) or 0)

        print(f"📊 @{handle} ({tier}) has posted {current_count}/{daily_limit} memes today")

        return current_count < daily_limit, current_count, daily_limit, tier

    except Exception as e:
        print(f"❌ Error checking meme limit for @{handle}: {str(e)}")
        return True, 0, 10, "Standard"  # Default to allowing with standard limit

def store_meme_tweet(tweet):
    key = f"meme:{tweet['id']}"
    if r.exists(key):
        return False

    author_id = tweet["author_id"]
    handle = fetch_author_handle(author_id)
    if not handle:
        return False

    wallet = r.get(f"twitter:{handle.lower()}")
    if not wallet:
        print(f"❌ @{handle} has no wallet linked.")
        return False

    wallet = wallet.decode()

    # Check daily meme limit
    can_post, current_count, daily_limit, tier = check_daily_meme_limit(handle, wallet)
    if not can_post:
        print(f"🚫 @{handle} has reached daily limit ({current_count}/{daily_limit} memes) - Tweet {tweet['id']} rejected")
        return False
    metrics = tweet["public_metrics"]
    xp = calculate_xp(metrics["like_count"], metrics["retweet_count"])
    tier, waldo = calculate_rewards(metrics["like_count"], metrics["retweet_count"], DEFAULT_REWARD_TYPE)

    key = f"meme:{tweet['id']}"
    tweet_id = tweet["id"]

    r.hset(key, mapping={
        "author_id": author_id,
        "handle": handle,
        "text": tweet["text"],
        "likes": metrics["like_count"],
        "retweets": metrics["retweet_count"],
        "created_at": tweet["created_at"],
        "wallet": wallet,
        "tier": tier,
        "waldo": waldo,
        "xp": xp,
        "claimed": 0,
        "reward_type": DEFAULT_REWARD_TYPE,
        "stake_selected": 0,
        "stake_release": ""
    })

    # 👇 Additional tweet-based indexes for frontend dashboard
    r.sadd(f"wallet:tweets:{wallet}", tweet_id)
    r.set(f"meme:xp:{tweet_id}", xp)
    r.set(f"meme:waldo:{tweet_id}", waldo)
    r.set(f"meme:nft_minted:{tweet_id}", "false")

    # XP tracking (NFT eligibility removed - whitepaper doesn't specify XP requirement)
    r.set(f"meme:xp:{tweet['id']}", xp)
    r.incrby(f"wallet:xp:{wallet}", xp)
    # All memes are eligible for NFT minting (50 WALDO cost only)

    # Increment daily meme count
    today = datetime.now().strftime('%Y-%m-%d')
    daily_key = f"meme_count:{handle}:{today}"
    r.incr(daily_key)
    r.expire(daily_key, 60*60*24)  # Expire at end of day

    new_count = int(r.get(daily_key) or 0)
    print(f"✅ Stored meme {tweet['id']} for @{handle} ({tier}) - Daily count: {new_count}/{daily_limit}")

    return True

def fetch_and_store():
    if USE_MOCK_DATA:
        tweets = [{
            "id": str(uuid.uuid4()),
            "author_id": "test123",
            "text": "Test meme #WaldoMeme",
            "public_metrics": {"like_count": 80, "retweet_count": 20},
            "created_at": datetime.now(timezone.utc).isoformat()
        }]
    else:
        res = requests.get(URL, headers=HEADERS)
        if res.status_code != 200:
            return
        tweets = res.json().get("data", [])
    stored = sum(1 for t in tweets if store_meme_tweet(t))
    print(f"✅ Stored {stored} tweet(s)")

async def send_waldo(wallet, amount):
    client = JsonRpcClient(XRPL_NODE)
    dist_wallet = Wallet(seed=DISTRIBUTOR_SECRET, sequence=0)
    tx = Payment(account=dist_wallet.classic_address, destination=wallet,
                 amount={"currency": "WALDO", "value": str(amount), "issuer": WALDO_ISSUER})
    signed = await autofill_and_sign(tx, dist_wallet, client)
    return await submit_and_wait(signed, client)

# === Routes ===
@app.route("/")
def status():
    return jsonify({"status": "✅ WALDO bot live", "mode": "LIVE" if LIVE_MODE else "TEST"})

@app.route("/payout/<reward_type>/<tweet_id>", methods=["POST"])
@limiter.limit("5 per minute")
def payout(reward_type, tweet_id):
    key = f"meme:{tweet_id}"
    data = r.hgetall(key)
    if not data:
        return jsonify({"error": "Tweet not found"}), 404
    if int(data.get(b"claimed", 0)):
        return jsonify({"message": "Already claimed"}), 200
    if data.get(b"reward_type", b"").decode() != reward_type:
        return jsonify({"error": "Wrong reward type"}), 400

    wallet = data[b"wallet"].decode()
    amount = float(data[b"waldo"].decode())
    created = datetime.fromisoformat(data[b"created_at"].decode())
    if (datetime.now(timezone.utc) - created) > timedelta(days=30):
        return jsonify({"error": "Expired meme"}), 400

    if reward_type == "stake":
        r.hset(key, mapping={
            "stake_selected": 1,
            "stake_release": get_month_end().isoformat()
        })

    if LIVE_MODE:
        try:
            tx = asyncio.run(send_waldo(wallet, amount))
            r.hset(key, "claimed", 1)
            return jsonify({"message": "✅ WALDO sent", "tx": tx.result.tx_json.hash})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    else:
        print(f"🧪 Test payout: {amount} WALDO to {wallet}")
        return jsonify({"message": "Test payout", "amount": amount, "wallet": wallet})

# === Background fetch ===
def run_polling():
    while True:
        try:
            fetch_and_store()
        except Exception as e:
            print("Polling error:", e)
        time.sleep(600)

if __name__ == "__main__":
    fetch_and_store()
    threading.Thread(target=run_polling, daemon=True).start()
    app.run(host="0.0.0.0", port=PORT)
