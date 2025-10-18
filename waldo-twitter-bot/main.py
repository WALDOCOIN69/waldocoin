import os
import uuid
import requests
import asyncio
import redis
import threading
import time
import json
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

# AI Content Verification Config
AI_VERIFICATION_ENABLED = os.getenv("AI_CONTENT_VERIFICATION_ENABLED", "false").lower() == "true"
AI_CONFIDENCE_THRESHOLD = int(os.getenv("AI_CONFIDENCE_THRESHOLD", "70"))
GOOGLE_VISION_API_KEY = os.getenv("GOOGLE_VISION_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TINEYE_API_KEY = os.getenv("TINEYE_API_KEY")

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "User-Agent": "WaldoBot"
}

# Twitter search - catch all hashtag variations
QUERY = "(#WaldoMeme OR #waldomeme OR #Waldomeme OR #WALDOMEME) -is:retweet"
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

    # Check AI violation status before processing
    violation_status = check_ai_violation_status(wallet)
    if violation_status["status"] in ["BANNED", "BLACKLISTED"]:
        print(f"🚫 @{handle} is {violation_status['status']} - Tweet {tweet['id']} rejected")
        print(f"📋 Reason: {violation_status.get('reason', 'Unknown')}")
        return False
    elif violation_status["status"] == "REQUIRES_VERIFICATION":
        print(f"⚠️ @{handle} requires manual verification - Tweet {tweet['id']} rejected")
        print(f"📋 Reason: {violation_status.get('reason', 'Unknown')}")
        return False

    # Check daily meme limit
    can_post, current_count, daily_limit, tier = check_daily_meme_limit(handle, wallet)
    if not can_post:
        print(f"🚫 @{handle} has reached daily limit ({current_count}/{daily_limit} memes) - Tweet {tweet['id']} rejected")
        return False
    # AI Content Verification
    ai_verification = asyncio.run(verify_content_with_ai(tweet))

    # Check AI verification threshold
    if AI_VERIFICATION_ENABLED and ai_verification["confidence"] < AI_CONFIDENCE_THRESHOLD:
        print(f"🤖 Tweet {tweet['id']} failed AI verification ({ai_verification['confidence']}% < {AI_CONFIDENCE_THRESHOLD}%)")

        # Log AI verification failure as violation
        asyncio.run(log_ai_violation(handle, wallet, tweet['id'], ai_verification))

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

    # Store AI verification results
    r.set(f"meme:ai_verified:{tweet['id']}", "true" if ai_verification["ai_verified"] else "false")
    r.set(f"meme:ai_confidence:{tweet['id']}", str(ai_verification["confidence"]))

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
            "text": "Test meme #WaldoMeme (catches all variations: #waldomeme #Waldomeme #WALDOMEME)",
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

async def verify_content_with_ai(tweet_data):
    """FREE AI-powered content verification"""
    if not AI_VERIFICATION_ENABLED:
        return {"ai_verified": True, "confidence": 0, "reason": "AI_DISABLED"}

    try:
        print(f"🆓 Running FREE AI verification for tweet {tweet_data['id']}")

        # FREE Content Verification
        ai_result = await run_free_ai_verification(tweet_data)

        # Store AI verification result
        r.set(f"ai:free:{tweet_data['id']}", json.dumps(ai_result), ex=60*60*24*7)

        print(f"🆓 FREE AI verification complete: {ai_result['confidence']}% confidence")
        return ai_result

    except Exception as e:
        print(f"❌ FREE AI verification failed: {str(e)}")
        return {"ai_verified": True, "confidence": 0, "error": str(e)}

async def run_free_ai_verification(tweet_data):
    """Run FREE AI verification checks"""
    try:
        results = {
            "ai_verified": True,
            "confidence": 0,
            "method": "FREE_VERIFICATION",
            "checks": {}
        }

        # 1. FREE Engagement Analysis
        engagement_check = analyze_engagement_patterns_free(tweet_data)
        results["checks"]["engagement"] = engagement_check

        # 2. FREE Content Analysis
        content_check = analyze_content_free(tweet_data.get("text", ""))
        results["checks"]["content"] = content_check

        # 3. FREE Originality Check (basic)
        originality_check = await check_originality_free(tweet_data)
        results["checks"]["originality"] = originality_check

        # 4. FREE Profile Analysis (NEW!)
        profile_check = analyze_twitter_profile_free(tweet_data)
        results["checks"]["profile"] = profile_check

        # Calculate overall confidence
        confidence_scores = [
            engagement_check.get("confidence", 0),
            content_check.get("confidence", 0),
            originality_check.get("confidence", 0),
            profile_check.get("confidence", 0)
        ]

        valid_scores = [s for s in confidence_scores if s > 0]
        results["confidence"] = sum(valid_scores) / len(valid_scores) if valid_scores else 0

        # Determine verification status (now includes profile check)
        results["ai_verified"] = (
            engagement_check.get("is_legitimate", True) and
            content_check.get("is_appropriate", True) and
            originality_check.get("is_original", True) and
            profile_check.get("is_legitimate", True)
        )

        return results

    except Exception as e:
        return {
            "ai_verified": True,
            "confidence": 0,
            "error": str(e),
            "method": "FREE_VERIFICATION"
        }

def analyze_engagement_patterns_free(tweet_data):
    """FREE engagement pattern analysis"""
    try:
        metrics = tweet_data.get("public_metrics", {})
        likes = metrics.get("like_count", 0)
        retweets = metrics.get("retweet_count", 0)

        suspicious_patterns = []
        confidence = 100

        # Check engagement ratio
        ratio = likes / max(retweets, 1)
        if ratio > 100 or ratio < 1:
            suspicious_patterns.append("EXTREME_RATIO")
            confidence -= 30

        # Check for round numbers (bot indicator)
        if likes > 0 and likes % 10 == 0 and retweets > 0 and retweets % 10 == 0:
            suspicious_patterns.append("ROUND_NUMBERS")
            confidence -= 20

        # Check for unrealistic engagement
        total_engagement = likes + retweets
        if total_engagement > 10000:  # Very high engagement
            suspicious_patterns.append("HIGH_ENGAGEMENT")
            confidence -= 15

        is_legitimate = confidence >= 60

        return {
            "is_legitimate": is_legitimate,
            "confidence": max(confidence, 0),
            "suspicious_patterns": suspicious_patterns,
            "engagement_ratio": ratio
        }

    except Exception as e:
        return {
            "is_legitimate": True,
            "confidence": 0,
            "error": str(e)
        }

def analyze_content_free(text):
    """FREE content analysis"""
    try:
        confidence = 100
        issues = []

        # Check spam indicators
        spam_score = calculate_spam_score_free(text)
        if spam_score > 70:
            issues.append("HIGH_SPAM")
            confidence -= 40

        # Check WALDO relevance
        waldo_score = check_waldo_relevance_free(text)
        if waldo_score < 20:
            issues.append("LOW_RELEVANCE")
            confidence -= 20

        # Check inappropriate content
        if has_inappropriate_content_free(text):
            issues.append("INAPPROPRIATE")
            confidence -= 50

        is_appropriate = confidence >= 50

        return {
            "is_appropriate": is_appropriate,
            "confidence": max(confidence, 0),
            "issues": issues,
            "spam_score": spam_score,
            "waldo_score": waldo_score
        }

    except Exception as e:
        return {
            "is_appropriate": True,
            "confidence": 0,
            "error": str(e)
        }

async def check_originality_free(tweet_data):
    """FREE originality check using text hashing"""
    try:
        text = tweet_data.get("text", "")
        tweet_id = tweet_data["id"]

        # Generate text hash for duplicate detection
        text_hash = hash(text.lower().strip())
        hash_key = f"text_hash:{text_hash}"

        # Check if we've seen this text before
        existing_tweet = r.get(hash_key)
        if existing_tweet and existing_tweet.decode() != tweet_id:
            return {
                "is_original": False,
                "confidence": 95,
                "reason": "DUPLICATE_TEXT",
                "original_tweet": existing_tweet.decode()
            }

        # Store hash for future checks
        r.set(hash_key, tweet_id, ex=60*60*24*30)  # 30 days

        return {
            "is_original": True,
            "confidence": 85,
            "reason": "APPEARS_ORIGINAL"
        }

    except Exception as e:
        return {
            "is_original": True,
            "confidence": 0,
            "error": str(e)
        }

def calculate_spam_score_free(text):
    """Calculate spam score using FREE methods"""
    score = 0

    # Excessive caps
    caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
    if caps_ratio > 0.5:
        score += 30

    # Excessive punctuation
    punct_count = sum(1 for c in text if c in "!?.,;:")
    if punct_count > len(text) * 0.2:
        score += 20

    # Repeated characters
    if any(text.count(char * 4) > 0 for char in "abcdefghijklmnopqrstuvwxyz"):
        score += 25

    # Too short
    if len(text.strip()) < 10:
        score += 15

    return min(score, 100)

def check_waldo_relevance_free(text):
    """Check WALDO relevance using FREE methods"""
    waldo_keywords = ["waldo", "waldocoin", "wlo", "$wlo", "#waldomeme", "meme"]
    text_lower = text.lower()

    matches = sum(1 for keyword in waldo_keywords if keyword in text_lower)
    return (matches / len(waldo_keywords)) * 100

def has_inappropriate_content_free(text):
    """Check for inappropriate content using FREE methods"""
    inappropriate_words = ["scam", "fraud", "steal", "hack", "illegal", "fake"]
    text_lower = text.lower()

    return any(word in text_lower for word in inappropriate_words)

def analyze_twitter_profile_free(tweet_data):
    """FREE Twitter profile analysis for fake account detection"""
    try:
        author_id = tweet_data.get("author_id")
        if not author_id:
            return {
                "is_legitimate": True,
                "confidence": 0,
                "reason": "NO_AUTHOR_ID"
            }

        confidence = 100
        suspicious_indicators = []

        # Get cached profile data (if available)
        profile_data = get_cached_profile_data(author_id)

        if not profile_data:
            # No profile data available, use basic checks
            return {
                "is_legitimate": True,
                "confidence": 50,
                "reason": "PROFILE_DATA_UNAVAILABLE"
            }

        # 1. Account Age Analysis
        if "created_at" in profile_data:
            account_age = analyze_account_age_free(profile_data["created_at"])
            if account_age["is_suspicious"]:
                suspicious_indicators.append("NEW_ACCOUNT")
                confidence -= 25

        # 2. Username Pattern Analysis
        if "username" in profile_data:
            username_analysis = analyze_username_pattern_free(profile_data["username"])
            if username_analysis["is_suspicious"]:
                suspicious_indicators.append("SUSPICIOUS_USERNAME")
                confidence -= 15

        # 3. Follower Ratio Analysis
        if "public_metrics" in profile_data:
            follower_analysis = analyze_follower_ratio_free(profile_data["public_metrics"])
            if follower_analysis["is_suspicious"]:
                suspicious_indicators.append("SUSPICIOUS_FOLLOWER_RATIO")
                confidence -= 30

        # 4. Profile Picture Analysis
        if "profile_image_url" in profile_data:
            pic_analysis = analyze_profile_picture_free(profile_data["profile_image_url"])
            if pic_analysis["is_suspicious"]:
                suspicious_indicators.append("SUSPICIOUS_PROFILE_PIC")
                confidence -= 20

        is_legitimate = confidence >= 60

        return {
            "is_legitimate": is_legitimate,
            "confidence": max(confidence, 0),
            "suspicious_indicators": suspicious_indicators,
            "profile_checks": len(suspicious_indicators) == 0
        }

    except Exception as e:
        return {
            "is_legitimate": True,
            "confidence": 0,
            "error": str(e)
        }

def get_cached_profile_data(author_id):
    """Get cached profile data from Redis"""
    try:
        cache_key = f"profile:{author_id}"
        cached_data = r.get(cache_key)
        if cached_data:
            return json.loads(cached_data)
        return None
    except Exception as e:
        print(f"Error getting cached profile data: {e}")
        return None

def analyze_account_age_free(created_at):
    """Analyze account age for suspicious patterns"""
    try:
        from datetime import datetime, timezone

        # Parse Twitter date format
        account_date = datetime.strptime(created_at, "%Y-%m-%dT%H:%M:%S.%fZ")
        account_date = account_date.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)

        age_days = (now - account_date).days

        # Accounts less than 30 days old are suspicious
        is_suspicious = age_days < 30

        return {
            "is_suspicious": is_suspicious,
            "age_days": age_days,
            "reason": "ACCOUNT_TOO_NEW" if is_suspicious else "ACCOUNT_AGE_OK"
        }

    except Exception as e:
        return {"is_suspicious": False, "error": str(e)}

def analyze_username_pattern_free(username):
    """Analyze username for bot-like patterns"""
    try:
        import re

        suspicious_reasons = []

        # 1. Letters followed by many numbers (bot pattern)
        if re.match(r'^[a-zA-Z]+\d{4,}$', username):
            suspicious_reasons.append("LETTERS_PLUS_NUMBERS")

        # 2. Excessive numbers
        number_count = len(re.findall(r'\d', username))
        if number_count > len(username) * 0.5:
            suspicious_reasons.append("EXCESSIVE_NUMBERS")

        # 3. Bot keywords
        bot_keywords = ['bot', 'auto', 'gen', 'fake', 'temp', 'test']
        if any(keyword in username.lower() for keyword in bot_keywords):
            suspicious_reasons.append("BOT_KEYWORDS")

        # 4. Very long username
        if len(username) > 15:
            suspicious_reasons.append("VERY_LONG_USERNAME")

        return {
            "is_suspicious": len(suspicious_reasons) > 0,
            "reasons": suspicious_reasons,
            "username": username
        }

    except Exception as e:
        return {"is_suspicious": False, "error": str(e)}

def analyze_follower_ratio_free(public_metrics):
    """Analyze follower/following ratios for suspicious patterns"""
    try:
        followers = public_metrics.get("followers_count", 0)
        following = public_metrics.get("following_count", 0)

        suspicious_reasons = []

        # 1. Following way more than followers
        if following > 100 and followers > 0:
            ratio = following / followers
            if ratio > 10:
                suspicious_reasons.append("HIGH_FOLLOWING_RATIO")

        # 2. Very low followers but high following
        if followers < 10 and following > 500:
            suspicious_reasons.append("LOW_FOLLOWERS_HIGH_FOLLOWING")

        # 3. Identical counts (bot pattern)
        if followers == following and followers > 0:
            suspicious_reasons.append("IDENTICAL_COUNTS")

        # 4. Round numbers (bot indicator)
        if (followers > 0 and followers % 100 == 0 and
            following > 0 and following % 100 == 0):
            suspicious_reasons.append("ROUND_NUMBERS")

        return {
            "is_suspicious": len(suspicious_reasons) > 0,
            "reasons": suspicious_reasons,
            "followers": followers,
            "following": following
        }

    except Exception as e:
        return {"is_suspicious": False, "error": str(e)}

def analyze_profile_picture_free(profile_image_url):
    """Analyze profile picture for default/suspicious patterns"""
    try:
        suspicious_reasons = []

        # Check for default Twitter profile pictures
        default_patterns = [
            'default_profile_images',
            'default_profile',
            'sticky/default_profile',
            '_normal.jpg'
        ]

        if any(pattern in profile_image_url for pattern in default_patterns):
            suspicious_reasons.append("DEFAULT_PROFILE_PIC")

        # Check for suspicious URL patterns
        suspicious_patterns = ['temp', 'generated', 'fake', 'bot', 'auto']
        if any(pattern in profile_image_url.lower() for pattern in suspicious_patterns):
            suspicious_reasons.append("SUSPICIOUS_PIC_URL")

        return {
            "is_suspicious": len(suspicious_reasons) > 0,
            "reasons": suspicious_reasons,
            "profile_image_url": profile_image_url
        }

    except Exception as e:
        return {"is_suspicious": False, "error": str(e)}

async def log_ai_violation(handle, wallet, tweet_id, ai_verification):
    """Log AI verification failure and apply escalating consequences"""
    try:
        from datetime import datetime
        print(f"🚨 Logging AI violation for @{handle} (wallet: {wallet})")

        # Determine violation type based on AI checks
        violation_type = determine_violation_type(ai_verification)

        # Get current violation count
        violation_key = f"ai_violations:{wallet}"
        current_violations = r.get(violation_key)
        violation_count = int(current_violations) if current_violations else 0
        violation_count += 1

        # Store violation details
        violation_data = {
            "wallet": wallet,
            "handle": handle,
            "tweet_id": tweet_id,
            "violation_type": violation_type,
            "confidence": ai_verification.get("confidence", 0),
            "checks": ai_verification.get("checks", {}),
            "timestamp": datetime.now().isoformat(),
            "violation_number": violation_count
        }

        # Store violation record
        violation_record_key = f"ai_violation:{wallet}:{tweet_id}"
        r.set(violation_record_key, json.dumps(violation_data), ex=60*60*24*30)  # 30 days

        # Update violation count
        r.set(violation_key, violation_count, ex=60*60*24*7)  # 7 days expiry

        # Apply escalating consequences
        consequences = await apply_ai_violation_consequences(wallet, handle, violation_count, violation_type)

        print(f"🚨 AI Violation #{violation_count} logged for @{handle}: {violation_type}")
        print(f"📋 Consequences: {consequences}")

        # Store in security events for admin monitoring
        security_event = {
            "type": "AI_VERIFICATION_FAILURE",
            "wallet": wallet,
            "handle": handle,
            "violation_type": violation_type,
            "violation_count": violation_count,
            "consequences": consequences,
            "timestamp": datetime.now().isoformat()
        }

        r.lpush("security:events", json.dumps(security_event))
        r.ltrim("security:events", 0, 99)  # Keep last 100 events

        return consequences

    except Exception as e:
        print(f"❌ Error logging AI violation: {e}")
        return "ERROR_LOGGING_VIOLATION"

def determine_violation_type(ai_verification):
    """Determine the primary violation type from AI verification results"""
    checks = ai_verification.get("checks", {})

    # Priority order: Profile > Content > Engagement > Originality
    if not checks.get("profile", {}).get("is_legitimate", True):
        profile_indicators = checks.get("profile", {}).get("suspicious_indicators", [])
        if "NEW_ACCOUNT" in profile_indicators:
            return "FAKE_PROFILE_NEW_ACCOUNT"
        elif "SUSPICIOUS_USERNAME" in profile_indicators:
            return "FAKE_PROFILE_BOT_USERNAME"
        elif "SUSPICIOUS_FOLLOWER_RATIO" in profile_indicators:
            return "FAKE_PROFILE_FOLLOWER_MANIPULATION"
        else:
            return "FAKE_PROFILE_GENERAL"

    elif not checks.get("content", {}).get("is_appropriate", True):
        content_issues = checks.get("content", {}).get("issues", [])
        if "INAPPROPRIATE" in content_issues:
            return "INAPPROPRIATE_CONTENT"
        elif "HIGH_SPAM" in content_issues:
            return "SPAM_CONTENT"
        else:
            return "CONTENT_VIOLATION"

    elif not checks.get("engagement", {}).get("is_legitimate", True):
        engagement_patterns = checks.get("engagement", {}).get("suspicious_patterns", [])
        if "ENGAGEMENT_SPIKE" in engagement_patterns:
            return "ENGAGEMENT_MANIPULATION"
        else:
            return "SUSPICIOUS_ENGAGEMENT"

    elif not checks.get("originality", {}).get("is_original", True):
        return "DUPLICATE_CONTENT"

    else:
        return "LOW_CONFIDENCE_SCORE"

async def apply_ai_violation_consequences(wallet, handle, violation_count, violation_type):
    """Apply escalating consequences based on violation count and type"""
    try:
        from datetime import datetime
        consequences = []

        # Violation 1: Warning + Temporary Rate Limit
        if violation_count == 1:
            consequences.append("WARNING_ISSUED")
            consequences.append("RATE_LIMITED_1_HOUR")

            # Set 1-hour rate limit
            rate_limit_key = f"rate_limit:{wallet}:ai_violation"
            r.set(rate_limit_key, "1", ex=60*60)  # 1 hour

        # Violation 2: Stricter Rate Limit + Daily Limit Reduction
        elif violation_count == 2:
            consequences.append("FINAL_WARNING")
            consequences.append("RATE_LIMITED_6_HOURS")
            consequences.append("DAILY_LIMIT_REDUCED")

            # Set 6-hour rate limit
            rate_limit_key = f"rate_limit:{wallet}:ai_violation"
            r.set(rate_limit_key, "2", ex=60*60*6)  # 6 hours

            # Reduce daily meme limit by 50%
            daily_limit_key = f"daily_limit_reduction:{wallet}"
            r.set(daily_limit_key, "50", ex=60*60*24*7)  # 7 days

        # Violation 3: Temporary Ban
        elif violation_count == 3:
            consequences.append("TEMPORARY_BAN_24_HOURS")

            # Set 24-hour ban
            ban_key = f"banned:{wallet}"
            r.set(ban_key, json.dumps({
                "reason": f"AI_VIOLATIONS_{violation_type}",
                "violation_count": violation_count,
                "banned_at": datetime.now().isoformat(),
                "ban_duration": "24_HOURS"
            }), ex=60*60*24)  # 24 hours

        # Violation 4: Extended Ban
        elif violation_count == 4:
            consequences.append("EXTENDED_BAN_7_DAYS")

            # Set 7-day ban
            ban_key = f"banned:{wallet}"
            r.set(ban_key, json.dumps({
                "reason": f"REPEATED_AI_VIOLATIONS_{violation_type}",
                "violation_count": violation_count,
                "banned_at": datetime.now().isoformat(),
                "ban_duration": "7_DAYS"
            }), ex=60*60*24*7)  # 7 days

        # Violation 5+: Permanent Ban
        elif violation_count >= 5:
            consequences.append("PERMANENT_BAN")

            # Set permanent ban (1 year expiry for safety)
            ban_key = f"banned:{wallet}"
            r.set(ban_key, json.dumps({
                "reason": f"PERSISTENT_AI_VIOLATIONS_{violation_type}",
                "violation_count": violation_count,
                "banned_at": datetime.now().isoformat(),
                "ban_duration": "PERMANENT"
            }), ex=60*60*24*365)  # 1 year

            # Add to permanent blacklist
            blacklist_key = f"blacklist:{wallet}"
            r.set(blacklist_key, json.dumps({
                "reason": f"PERSISTENT_AI_VIOLATIONS_{violation_type}",
                "blacklisted_at": datetime.now().isoformat(),
                "handle": handle
            }))

        # Special handling for severe violations (fake profiles)
        if violation_type.startswith("FAKE_PROFILE"):
            if violation_count == 1:
                consequences.append("PROFILE_FLAGGED_FOR_REVIEW")
            elif violation_count >= 2:
                consequences.append("PROFILE_VERIFICATION_REQUIRED")

                # Require manual verification
                verification_key = f"requires_verification:{wallet}"
                r.set(verification_key, json.dumps({
                    "reason": "FAKE_PROFILE_DETECTED",
                    "violation_count": violation_count,
                    "flagged_at": datetime.now().isoformat()
                }))

        return consequences

    except Exception as e:
        print(f"❌ Error applying AI violation consequences: {e}")
        return ["ERROR_APPLYING_CONSEQUENCES"]

def check_ai_violation_status(wallet):
    """Check if wallet has AI violation restrictions"""
    try:
        # Check if banned
        ban_key = f"banned:{wallet}"
        ban_data = r.get(ban_key)
        if ban_data:
            ban_info = json.loads(ban_data)
            return {
                "status": "BANNED",
                "reason": ban_info.get("reason"),
                "duration": ban_info.get("ban_duration"),
                "banned_at": ban_info.get("banned_at")
            }

        # Check if blacklisted
        blacklist_key = f"blacklist:{wallet}"
        blacklist_data = r.get(blacklist_key)
        if blacklist_data:
            blacklist_info = json.loads(blacklist_data)
            return {
                "status": "BLACKLISTED",
                "reason": blacklist_info.get("reason"),
                "blacklisted_at": blacklist_info.get("blacklisted_at")
            }

        # Check if rate limited
        rate_limit_key = f"rate_limit:{wallet}:ai_violation"
        rate_limited = r.get(rate_limit_key)
        if rate_limited:
            return {
                "status": "RATE_LIMITED",
                "level": rate_limited.decode() if isinstance(rate_limited, bytes) else rate_limited
            }

        # Check if requires verification
        verification_key = f"requires_verification:{wallet}"
        verification_data = r.get(verification_key)
        if verification_data:
            verification_info = json.loads(verification_data)
            return {
                "status": "REQUIRES_VERIFICATION",
                "reason": verification_info.get("reason"),
                "flagged_at": verification_info.get("flagged_at")
            }

        return {"status": "CLEAR"}

    except Exception as e:
        print(f"❌ Error checking AI violation status: {e}")
        return {"status": "ERROR"}

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


# 🔐 Simple auth decorator for internal endpoints
from functools import wraps

def require_admin_key(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        admin_key = request.headers.get('X-Admin-Key')
        if not admin_key or admin_key != os.getenv('X_ADMIN_KEY'):
            return jsonify({"error": "Unauthorized"}), 403
        return f(*args, **kwargs)
    return wrapper

@app.route("/payout/<reward_type>/<tweet_id>", methods=["POST"])
@require_admin_key

@limiter.limit("3 per minute")
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
