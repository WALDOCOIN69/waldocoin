"""
Memeology Backend API Worker
FastAPI server for meme generation and AI suggestions
Part of WALDO LABS ecosystem
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import os
from typing import Optional, Dict
from xrpl.clients import JsonRpcClient
from xrpl.models.requests import AccountNFTs, AccountLines, AccountInfo
from xrpl.wallet import Wallet
import json
import uuid

app = FastAPI(title="Memeology API", description="AI-Powered Meme Generator by WALDO LABS")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://memeology.fun"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class MemeCreateRequest(BaseModel):
    template_id: str
    text_top: str
    text_bottom: str
    user_id: Optional[str] = None

class AISuggestRequest(BaseModel):
    message: str
    user_id: Optional[str] = None
    ai_model: str = "groq"

# Imgflip API credentials (must be provided via environment; no real defaults committed)
IMGFLIP_USERNAME = os.getenv("IMGFLIP_USERNAME")
IMGFLIP_PASSWORD = os.getenv("IMGFLIP_PASSWORD")

# XRPL Configuration
XRPL_SERVER = os.getenv("XRPL_SERVER", "https://s1.ripple.com:51234")  # Mainnet
# XRPL_SERVER = "https://s.altnet.rippletest.net:51234"  # Testnet

# WALDOCOIN Token Configuration
WLO_ISSUER = os.getenv("WLO_ISSUER", "rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU")  # WALDOCOIN issuer
WLO_CURRENCY = "WLO"

# XUMM API Configuration (for wallet login)
XUMM_API_KEY = os.getenv("XUMM_API_KEY", "")
XUMM_API_SECRET = os.getenv("XUMM_API_SECRET", "")

# Store for XUMM login sessions (in production, use Redis or database)
xumm_sessions: Dict[str, dict] = {}

# Store for user meme creation tracking (in production, use database)
user_meme_counts: Dict[str, dict] = {}  # {wallet: {date: count}}

# Store for premium subscriptions (in production, use database)
premium_subscriptions: Dict[str, dict] = {}  # {wallet: {expires_at: timestamp, payment_tx: hash}}

@app.get("/")
async def root():
    return {
        "service": "Memeology API",
        "version": "1.0.0",
        "by": "WALDO LABS",
        "status": "running"
    }

@app.post("/api/auth/xumm/login")
async def xumm_login():
    """Initiate XUMM wallet login

    In production, this would use XUMM SDK to create a sign-in request.
    For now, we'll use a simplified approach.
    """
    try:
        if not XUMM_API_KEY or not XUMM_API_SECRET:
            # Fallback: Manual wallet address entry
            return {
                "success": False,
                "error": "XUMM not configured. Please enter wallet address manually.",
                "fallback": True
            }

        # Create XUMM sign-in request
        session_uuid = str(uuid.uuid4())

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://xumm.app/api/v1/platform/payload",
                headers={
                    "X-API-Key": XUMM_API_KEY,
                    "X-API-Secret": XUMM_API_SECRET,
                    "Content-Type": "application/json"
                },
                json={
                    "txjson": {
                        "TransactionType": "SignIn"
                    },
                    "options": {
                        "submit": False,
                        "return_url": {
                            "web": "https://memeology.fun"
                        }
                    }
                }
            )

            data = response.json()

            if data.get("uuid"):
                xumm_sessions[session_uuid] = {
                    "xumm_uuid": data["uuid"],
                    "created_at": "now",
                    "signed": False
                }

                return {
                    "success": True,
                    "uuid": session_uuid,
                    "qr_url": data["refs"]["qr_png"],
                    "websocket_url": data["refs"]["websocket_status"]
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to create XUMM payload")
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "fallback": True
        }

@app.get("/api/auth/xumm/status")
async def xumm_status(uuid: str):
    """Check XUMM login status"""
    try:
        if uuid not in xumm_sessions:
            return {"success": False, "error": "Session not found"}

        session = xumm_sessions[uuid]
        xumm_uuid = session["xumm_uuid"]

        if not XUMM_API_KEY or not XUMM_API_SECRET:
            return {"success": False, "error": "XUMM not configured"}

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://xumm.app/api/v1/platform/payload/{xumm_uuid}",
                headers={
                    "X-API-Key": XUMM_API_KEY,
                    "X-API-Secret": XUMM_API_SECRET
                }
            )

            data = response.json()

            if data.get("meta", {}).get("signed"):
                account = data["response"]["account"]
                xumm_sessions[uuid]["signed"] = True
                xumm_sessions[uuid]["account"] = account

                return {
                    "success": True,
                    "signed": True,
                    "account": account
                }
            elif data.get("meta", {}).get("cancelled"):
                return {
                    "success": True,
                    "signed": False,
                    "rejected": True
                }
            else:
                return {
                    "success": True,
                    "signed": False,
                    "pending": True
                }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@app.get("/api/templates/imgflip")
async def get_imgflip_templates(tier: str = "free"):
    """Fetch popular meme templates from Imgflip

    Tiers:
    - free: 50 templates, no fees
    - waldocoin: 150 templates, small WLO fees (0.1 WLO per meme), NFT art integration
    - premium: ALL 200+ templates, unlimited memes, no fees, $5/month (WLO/XRP/Credit), NFT art integration
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://api.imgflip.com/get_memes")
            data = response.json()

            if data.get("success"):
                all_memes = data["data"]["memes"]
                total_count = len(all_memes)

                if tier == "premium":
                    # Premium tier: ALL templates, unlimited, no fees
                    return {
                        "memes": all_memes,
                        "count": total_count,
                        "tier": "premium",
                        "features": {
                            "templates": "unlimited",
                            "memes_per_day": "unlimited",
                            "fee_per_meme": "none",
                            "ai_suggestions": "unlimited",
                            "custom_fonts": True,
                            "no_watermark": True,
                            "nft_art_integration": True
                        }
                    }
                elif tier == "waldocoin":
                    # WALDOCOIN tier: 150 templates, small fees
                    return {
                        "memes": all_memes[:150],
                        "count": 150,
                        "tier": "waldocoin",
                        "features": {
                            "templates": 150,
                            "memes_per_day": "unlimited",
                            "fee_per_meme": "0.1 WLO",
                            "ai_suggestions": "50/day",
                            "custom_fonts": True,
                            "no_watermark": False,
                            "nft_art_integration": True
                        },
                        "upgrade_message": f"⬆️ Upgrade to Premium for {total_count - 150} more templates and no fees!"
                    }
                else:
                    # Free tier: 50 templates, limited features
                    return {
                        "memes": all_memes[:50],
                        "count": 50,
                        "tier": "free",
                        "features": {
                            "templates": 50,
                            "memes_per_day": 10,
                            "fee_per_meme": "none",
                            "ai_suggestions": "5/day",
                            "custom_fonts": False,
                            "no_watermark": False,
                            "nft_art_integration": False
                        },
                        "upgrade_message": f"🪙 Hold WALDOCOIN for {150 - 50} more templates + NFT art OR 💎 Premium for unlimited!"
                    }
            else:
                raise HTTPException(status_code=500, detail="Failed to fetch templates")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/user/usage")
async def get_user_usage(wallet: str):
    """Get user's meme creation count for today"""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")

    if wallet not in user_meme_counts:
        user_meme_counts[wallet] = {}

    count = user_meme_counts[wallet].get(today, 0)

    return {
        "wallet": wallet,
        "date": today,
        "memes_created": count
    }

@app.post("/api/memes/create")
async def create_meme(request: MemeCreateRequest):
    """Generate a meme using Imgflip API

    Fees:
    - Free tier: No fee (but limited to 10/day)
    - WALDOCOIN tier: 0.1 WLO per meme (payment required)
    - Premium tier: No fee (unlimited)
    """
    try:
        from datetime import datetime

        # Get user tier if user_id (wallet) is provided
        tier = "free"
        wlo_balance = 0

        if request.user_id:
            tier_data = await check_user_tier(request.user_id)
            tier = tier_data.get("tier", "free")
            wlo_balance = tier_data.get("wlo_balance", 0)

            # Check usage limits for free tier
            if tier == "free":
                today = datetime.now().strftime("%Y-%m-%d")
                if request.user_id not in user_meme_counts:
                    user_meme_counts[request.user_id] = {}

                count = user_meme_counts[request.user_id].get(today, 0)

                if count >= 10:
                    raise HTTPException(
                        status_code=429,
                        detail="Daily limit reached (10 memes/day). Upgrade to WALDOCOIN or Premium for unlimited memes!"
                    )

            # Check payment for WALDOCOIN tier
            elif tier == "waldocoin":
                # In production, this would verify an XRPL payment transaction
                # For now, we'll just check if they have enough balance
                if wlo_balance < 0.1:
                    raise HTTPException(
                        status_code=402,
                        detail=f"Insufficient WLO balance. Need 0.1 WLO, have {wlo_balance} WLO"
                    )
                # TODO: Verify actual payment transaction hash
                # TODO: Deduct 0.1 WLO from balance (would be done via XRPL transaction)

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.imgflip.com/caption_image",
                data={
                    "template_id": request.template_id,
                    "username": IMGFLIP_USERNAME,
                    "password": IMGFLIP_PASSWORD,
                    "text0": request.text_top,
                    "text1": request.text_bottom,
                }
            )
            data = response.json()

            if data.get("success"):
                # Track usage
                if request.user_id:
                    today = datetime.now().strftime("%Y-%m-%d")
                    if request.user_id not in user_meme_counts:
                        user_meme_counts[request.user_id] = {}
                    user_meme_counts[request.user_id][today] = user_meme_counts[request.user_id].get(today, 0) + 1

                fee_charged = "none"
                if tier == "waldocoin":
                    fee_charged = "0.1 WLO"

                return {
                    "success": True,
                    "image_url": data["data"]["url"],
                    "page_url": data["data"]["page_url"],
                    "tier": tier,
                    "fee_charged": fee_charged,
                    "wlo_balance": wlo_balance
                }
            else:
                raise HTTPException(status_code=400, detail=data.get("error_message", "Failed to create meme"))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/suggest")
async def ai_suggest(request: AISuggestRequest):
    """Get AI suggestions for meme ideas"""
    try:
        # For now, return a simple response
        # TODO: Integrate with Groq, Claude, or Ollama
        suggestions = {
            "groq": "Try using the 'Distracted Boyfriend' template with text about crypto!",
            "claude": "How about a 'Drake Hotline Bling' meme comparing traditional finance vs DeFi?",
            "ollama": "The 'Two Buttons' template works great for decision-making memes!"
        }
        
        suggestion = suggestions.get(request.ai_model, suggestions["groq"])
        
        return {
            "success": True,
            "suggestion": f"💡 {suggestion}",
            "model": request.ai_model
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/wallet/balance")
async def get_wallet_balance(address: str):
    """Get WLO token balance for a wallet address"""
    try:
        client = JsonRpcClient(XRPL_SERVER)

        # Get account lines (trustlines) to find WLO balance
        from xrpl.models.requests import AccountLines
        request = AccountLines(account=address)
        response = client.request(request)

        wlo_balance = 0

        if response.is_successful():
            lines = response.result.get("lines", [])
            for line in lines:
                if line.get("currency") == WLO_CURRENCY and line.get("account") == WLO_ISSUER:
                    wlo_balance = float(line.get("balance", 0))
                    break

        return {
            "success": True,
            "address": address,
            "wlo_balance": wlo_balance,
            "wlo_issuer": WLO_ISSUER
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "wlo_balance": 0
        }

@app.get("/api/user/tier")
async def check_user_tier(wallet: str):
    """Check user's subscription tier based on WLO holdings and premium status

    Returns: free, waldocoin, or premium
    """
    try:
        # Check WLO balance
        balance_data = await get_wallet_balance(wallet)
        wlo_balance = balance_data.get("wlo_balance", 0)

        # Check premium subscription
        from datetime import datetime
        tier = "free"
        premium_expires = None

        if wallet in premium_subscriptions:
            sub = premium_subscriptions[wallet]
            expires_at = sub.get("expires_at")
            if expires_at and datetime.fromisoformat(expires_at) > datetime.now():
                tier = "premium"
                premium_expires = expires_at

        # Check WLO balance for WALDOCOIN tier (if not premium)
        if tier != "premium" and wlo_balance >= 1000:
            tier = "waldocoin"

        # Set features based on tier
        if tier == "premium":
            features = {
                "templates": "unlimited",
                "memes_per_day": "unlimited",
                "fee_per_meme": "none",
                "ai_suggestions": "unlimited",
                "custom_fonts": True,
                "no_watermark": True,
                "nft_art_integration": True
            }
        elif tier == "waldocoin":
            features = {
                "templates": 150,
                "memes_per_day": "unlimited",
                "fee_per_meme": "0.1 WLO",
                "ai_suggestions": "50/day",
                "custom_fonts": True,
                "no_watermark": False,
                "nft_art_integration": True
            }
        else:
            features = {
                "templates": 50,
                "memes_per_day": 10,
                "fee_per_meme": "none",
                "ai_suggestions": "5/day",
                "custom_fonts": False,
                "no_watermark": False,
                "nft_art_integration": False
            }

        return {
            "tier": tier,
            "wallet": wallet,
            "wlo_balance": wlo_balance,
            "premium_expires": premium_expires,
            "features": features
        }
    except Exception as e:
        return {
            "tier": "free",
            "wallet": wallet,
            "wlo_balance": 0,
            "error": str(e)
        }

@app.post("/api/premium/subscribe")
async def subscribe_premium(wallet: str, payment_tx: str):
    """Subscribe to Premium tier with XRP or WLO payment

    Payment: $5/month equivalent in XRP or WLO
    """
    try:
        # Verify payment transaction on XRPL
        client = JsonRpcClient(XRPL_SERVER)

        from xrpl.models.requests import Tx
        tx_request = Tx(transaction=payment_tx)
        tx_response = client.request(tx_request)

        if not tx_response.is_successful():
            raise HTTPException(status_code=400, detail="Invalid transaction hash")

        tx_data = tx_response.result

        # Verify transaction details
        # TODO: Check amount is correct ($5 equivalent)
        # TODO: Check destination is our wallet
        # TODO: Check transaction is validated

        # Add 30 days to subscription
        from datetime import datetime, timedelta
        expires_at = datetime.now() + timedelta(days=30)

        premium_subscriptions[wallet] = {
            "expires_at": expires_at.isoformat(),
            "payment_tx": payment_tx,
            "subscribed_at": datetime.now().isoformat()
        }

        return {
            "success": True,
            "tier": "premium",
            "expires_at": expires_at.isoformat(),
            "message": "Premium subscription activated! Enjoy unlimited memes!"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/user/nfts")
async def get_user_nfts(wallet_address: str):
    """Fetch user's NFTs from XRPL

    Returns NFT images that can be used in memes
    Only available for WALDOCOIN and Premium tiers
    """
    try:
        # Connect to XRPL
        client = JsonRpcClient(XRPL_SERVER)

        # Fetch NFTs owned by the wallet
        request = AccountNFTs(account=wallet_address)
        response = client.request(request)

        if not response.is_successful():
            raise HTTPException(status_code=400, detail="Failed to fetch NFTs from XRPL")

        nfts = []
        account_nfts = response.result.get("account_nfts", [])

        # Process each NFT
        for nft in account_nfts:
            try:
                nft_id = nft.get("NFTokenID")
                uri = nft.get("URI", "")

                # Decode URI from hex if present
                if uri:
                    try:
                        # URI is hex-encoded, decode it
                        uri_decoded = bytes.fromhex(uri).decode('utf-8')
                    except:
                        uri_decoded = uri

                    # Fetch metadata from URI
                    metadata = await fetch_nft_metadata(uri_decoded)

                    if metadata:
                        nfts.append({
                            "id": nft_id,
                            "name": metadata.get("name", f"NFT {nft_id[:8]}..."),
                            "image_url": metadata.get("image", ""),
                            "collection": metadata.get("collection", "Unknown"),
                            "token_id": nft_id,
                            "issuer": nft.get("Issuer", ""),
                            "uri": uri_decoded
                        })
                else:
                    # No URI, create basic entry
                    nfts.append({
                        "id": nft_id,
                        "name": f"NFT {nft_id[:8]}...",
                        "image_url": "",
                        "collection": "Unknown",
                        "token_id": nft_id,
                        "issuer": nft.get("Issuer", ""),
                        "uri": ""
                    })
            except Exception as e:
                print(f"Error processing NFT: {e}")
                continue

        # Filter out NFTs without images
        nfts_with_images = [nft for nft in nfts if nft.get("image_url")]

        return {
            "success": True,
            "wallet": wallet_address,
            "nfts": nfts_with_images,
            "count": len(nfts_with_images),
            "total_nfts": len(account_nfts)
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching NFTs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def fetch_nft_metadata(uri: str):
    """Fetch NFT metadata from URI (IPFS, HTTP, etc.)"""
    try:
        # Handle IPFS URIs
        if uri.startswith("ipfs://"):
            # Convert to HTTP gateway
            ipfs_hash = uri.replace("ipfs://", "")
            uri = f"https://ipfs.io/ipfs/{ipfs_hash}"

        # Fetch metadata
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(uri)

            if response.status_code == 200:
                metadata = response.json()

                # Handle IPFS image URLs
                if metadata.get("image", "").startswith("ipfs://"):
                    ipfs_hash = metadata["image"].replace("ipfs://", "")
                    metadata["image"] = f"https://ipfs.io/ipfs/{ipfs_hash}"

                return metadata
            else:
                return None
    except Exception as e:
        print(f"Error fetching metadata from {uri}: {e}")
        return None

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

