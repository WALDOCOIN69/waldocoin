import os
import uuid
import requests
import sqlite3
import asyncio
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify, request, make_response
from flask_cors import CORS
from flask_limiter.util import get_remote_address
from flask_limiter import Limiter
from dotenv import load_dotenv
from limits.storage import RedisStorage
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

redis_url = os.getenv("REDIS_URL") or "redis://localhost:6379"
limiter = Limiter(get_remote_address, app=app, storage_uri=redis_url, default_limits=["20 per minute"])

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

@app.errorhandler(429)
def ratelimit_handler(e):
    return make_response(jsonify({
        "error": "⏳ Too Many Requests. Please slow down and try again.",
        "retry_after_seconds": e.description
    }), 429)

@app.route('/', methods=['GET'])
def root():
    return jsonify({"status": "ok", "message": "🚀 WALDO Twitter Bot Alive!"})

def init_db():
    conn = sqlite3.connect("waldo.db")
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS meme_tweets (
        tweet_id TEXT PRIMARY KEY,
        author_id TEXT,
        wallet TEXT,
        text TEXT,
        likes INTEGER,
        retweets INTEGER,
        created_at TEXT,
        reward_tier INTEGER,
        waldo_amount REAL,
        reward_type TEXT,
        claimed BOOLEAN DEFAULT 0,
        stake_selected BOOLEAN DEFAULT 0,
        stake_release_date TEXT
    )''')
    conn.commit()
    conn.close()

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

def fetch_and_store():
    tweets = []
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

    if not tweets:
        print("ℹ️ No tweets found.")
        return

    conn = sqlite3.connect("waldo.db")
    c = conn.cursor()
    stored = 0

    for tweet in tweets:
        if "#waldomeme" not in tweet["text"].lower():
            continue
        metrics = tweet["public_metrics"]
        tier, waldo = calculate_rewards(metrics["like_count"], metrics["retweet_count"], DEFAULT_REWARD_TYPE)
        stake_selected = 1 if DEFAULT_REWARD_TYPE == "stake" else 0
        stake_release_date = get_month_end().isoformat() if stake_selected else None

        try:
            c.execute('''INSERT INTO meme_tweets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', (
                tweet["id"],
                tweet["author_id"],
                MOCK_WALLET,
                tweet["text"],
                metrics["like_count"],
                metrics["retweet_count"],
                tweet["created_at"],
                tier,
                waldo,
                DEFAULT_REWARD_TYPE,
                0,
                stake_selected,
                stake_release_date
            ))
            stored += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    conn.close()
    print(f"✅ Stored {stored} tweet(s)")

async def send_waldo(wallet, amount):
    client = JsonRpcClient(XRPL_NODE)
    distributor_wallet = Wallet(seed=DISTRIBUTOR_SECRET, sequence=0)

    tx = Payment(
        account=distributor_wallet.classic_address,
        destination=wallet,
        amount={
            "currency": "WALDO",
            "value": str(amount),
            "issuer": WALDO_ISSUER
        }
    )

    signed_tx = await autofill_and_sign(tx, distributor_wallet, client)
    return await submit_and_wait(signed_tx, client)

@app.route('/payout/instant/<tweet_id>', methods=['POST'])
@limiter.limit("5 per minute")
def payout_instant(tweet_id):
    conn = sqlite3.connect('waldo.db')
    c = conn.cursor()
    c.execute('SELECT claimed, reward_type, waldo_amount, wallet, created_at FROM meme_tweets WHERE tweet_id = ?', (tweet_id,))
    row = c.fetchone()
    conn.close()

    if not row: return jsonify({"error": "Tweet not found."}), 404
    claimed, reward_type, amount, wallet, created_at_str = row
    if claimed: return jsonify({"message": "Already claimed."}), 200
    if reward_type != "instant": return jsonify({"error": "Reward type is not 'instant'."}), 400

    if (datetime.now(timezone.utc) - datetime.fromisoformat(created_at_str)) > timedelta(days=30):
        return jsonify({"error": "⏳ Meme is too old to claim rewards."}), 400

    if LIVE_MODE:
        try:
            tx_response = asyncio.run(send_waldo(wallet, amount))
            conn = sqlite3.connect("waldo.db")
            c = conn.cursor()
            c.execute('UPDATE meme_tweets SET claimed = 1 WHERE tweet_id = ?', (tweet_id,))
            conn.commit()
            conn.close()

            return jsonify({
                "message": "✅ WALDO sent!",
                "transaction_result": tx_response.result.meta.TransactionResult,
                "tx_hash": tx_response.result.tx_json.hash,
                "tweet_id": tweet_id,
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

def run_background_polling():
    while True:
        try:
            fetch_and_store()
        except Exception as e:
            print("⚠️ Background fetch error:", e)
        time.sleep(600)  # every 10 minutes

if __name__ == "__main__":
    init_db()
    threading.Thread(target=run_background_polling, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5050)))


   
   
