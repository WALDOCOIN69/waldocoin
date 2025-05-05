import os
import uuid
import requests
import asyncio
import redis
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify, request, make_response
from flask_cors import CORS
from flask_limiter.util import get_remote_address
from flask_limiter import Limiter
from dotenv import load_dotenv
from xrpl.clients import JsonRpcClient
from xrpl.wallet import Wallet
from xrpl.models.transactions import Payment
from xrpl.asyncio.transaction import autofill_and_sign, submit_and_wait

load_dotenv()

# === CONFIG ===
USE_MOCK_DATA = True
DEFAULT_REWARD_TYPE = 'stake'
MOCK_WALLET = "rXYZ1234567890ABCDEF"
LIVE_MODE = os.getenv("LIVE_MODE", "false").lower() == "true"

app = Flask(__name__)
CORS(app)

limiter = Limiter(get_remote_address, app=app, storage_uri=os.getenv("REDIS_URL"), default_limits=["20 per minute"])

r = redis.from_url(os.getenv("REDIS_URL"))

BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN")
WALDO_ISSUER = os.getenv("WALDO_ISSUER")
DISTRIBUTOR_SECRET = os.getenv("DISTRIBUTOR_SECRET")
XRPL_NODE = os.getenv("XRPL_NODE", "https://s.altnet.rippletest.net:51234")

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "User-Agent": "WaldoBot"
}
QUERY = "#WaldoMeme -is:retweet"
TWEET_FIELDS = "author_id,public_metrics,created_at"
MAX_RESULTS = 50
URL = f"https://api.twitter.com/2/tweets/search/recent?query={QUERY}&tweet.fields={TWEET_FIELDS}&max_results={MAX_RESULTS}"

@app.route("/", methods=["GET"])
def root():
    return jsonify({"status": "ok", "message": "🚀 WALDO Twitter Bot Alive with Redis!"})

def get_month_end():
    now = datetime.now(timezone.utc)
    next_month = now.replace(day=28) + timedelta(days=4)
    return next_month.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(seconds=1)

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
            return t["tier"], round(base * 0.9, 2) if reward_type == "instant" else round(base * 1.15 * 0.95, 2)
    return 0, 0.0

def store_meme_tweet(tweet):
    key = f"meme:{tweet['id']}"
    if r.exists(key):
        return False

    metrics = tweet["public_metrics"]
    tier, waldo = calculate_rewards(metrics["like_count"], metrics["retweet_count"], DEFAULT_REWARD_TYPE)
    r.hset(key, mapping={
        "author_id": tweet["author_id"],
        "text": tweet["text"],
        "likes": metrics["like_count"],
        "retweets": metrics["retweet_count"],
        "created_at": tweet["created_at"],
        "wallet": MOCK_WALLET,
        "tier": tier,
        "waldo": waldo,
        "claimed": 0,
        "reward_type": DEFAULT_REWARD_TYPE,
        "stake_selected": int(DEFAULT_REWARD_TYPE == "stake"),
        "stake_release": get_month_end().isoformat() if DEFAULT_REWARD_TYPE == "stake" else "",
    })
    return True

def fetch_and_store():
    if USE_MOCK_DATA:
        print("⚙️ Using mock tweet data...")
        tweets = [{
            "id": str(uuid.uuid4()),
            "author_id": "987654321",
            "text": "Test meme #WaldoMeme",
            "public_metrics": {"like_count": 123, "retweet_count": 15},
            "created_at": datetime.now(timezone.utc).isoformat()
        }]
    else:
        res = requests.get(URL, headers=HEADERS)
        if res.status_code == 429:
            print("🚫 Rate limit hit.")
            return
        if res.status_code != 200:
            raise Exception(f"❌ Error fetching tweets: {res.status_code}")
        tweets = res.json().get("data", [])

    stored = sum(1 for t in tweets if store_meme_tweet(t))
    print(f"✅ Stored {stored} tweet(s)")

async def send_waldo(wallet, amount):
    client = JsonRpcClient(XRPL_NODE)
    distributor_wallet = Wallet(seed=DISTRIBUTOR_SECRET, sequence=0)
    tx = Payment(
        account=distributor_wallet.classic_address,
        destination=wallet,
        amount={"currency": "WALDO", "value": str(amount), "issuer": WALDO_ISSUER}
    )
    signed_tx = await autofill_and_sign(tx, distributor_wallet, client)
    return await submit_and_wait(signed_tx, client)

@app.route('/payout/instant/<tweet_id>', methods=['POST'])
@limiter.limit("5 per minute")
def payout_instant(tweet_id):
    key = f"meme:{tweet_id}"
    data = r.hgetall(key)
    if not data:
        return jsonify({"error": "Tweet not found."}), 404
    if int(data.get(b"claimed", b"0")):
        return jsonify({"message": "Already claimed."}), 200
    if data.get(b"reward_type", b"").decode() != "instant":
        return jsonify({"error": "Reward type is not 'instant'."}), 400

    created_at_str = data[b"created_at"].decode()
    if (datetime.now(timezone.utc) - datetime.fromisoformat(created_at_str)) > timedelta(days=30):
        return jsonify({"error": "⏳ Meme is too old to claim rewards."}), 400

    wallet = data[b"wallet"].decode()
    amount = float(data[b"waldo"].decode())

    if LIVE_MODE:
        try:
            tx_response = asyncio.run(send_waldo(wallet, amount))
            r.hset(key, "claimed", 1)
            return jsonify({
                "message": "✅ WALDO sent!",
                "tx_hash": tx_response.result.tx_json.hash,
                "waldo_amount": amount,
                "wallet": wallet
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    else:
        print(f"🧪 TEST MODE: Would send {amount} WALDO to {wallet} for tweet {tweet_id}")
        return jsonify({
            "message": "🧪 TEST MODE: Payout simulated.",
            "tweet_id": tweet_id,
            "waldo_amount": amount,
            "wallet": wallet
        })

import threading
import time

@app.before_first_request
def activate_job():
    threading.Thread(target=run_background_polling, daemon=True).start()

def run_background_polling():
    while True:
        try:
            fetch_and_store()
        except Exception as e:
            print("⚠️ Background fetch error:", e)
        time.sleep(600)  # every 10 minutes

if __name__ == "__main__":
    threading.Thread(target=run_background_polling, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5050)))
   