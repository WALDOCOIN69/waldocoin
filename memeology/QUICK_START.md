# ⚡ MEMEOLOGY - QUICK START GUIDE

## 🚀 **DEPLOY IN 5 MINUTES**

---

## **STEP 1: Upload Files** (2 minutes)

1. Login to **Hostinger File Manager**
2. Go to `/public_html/memeology.fun/`
3. Upload **ALL files** from `memeology/dist/` folder
4. Done! ✅

---

## **STEP 2: Configure Backend** (3 minutes)

### **Option A: Use waldocoin-backend** (Recommended)

Add to your waldocoin-backend:

```python
# Update CORS
allow_origins=["https://waldocoin.live", "https://memeology.fun"]

# Install dependencies
pip install xrpl-py==2.5.0 python-dateutil==2.8.2

# Add to .env
XUMM_API_KEY=your_key  # Get from https://apps.xumm.dev/
XUMM_API_SECRET=your_secret
WLO_ISSUER=rN7n7otQDd6FczFgLdlqtyMVrn3NnrcVcU
```

Copy these endpoints from `memeology/backend/main.py`:
- `/api/auth/xumm/login`
- `/api/auth/xumm/status`
- `/api/wallet/balance`
- `/api/user/tier`
- `/api/user/usage`
- `/api/user/nfts`
- `/api/premium/subscribe`

Restart backend. Done! ✅

---

## **STEP 3: Test** (1 minute)

1. Visit **https://memeology.fun**
2. Click "🔐 Login with XUMM"
3. Create a meme
4. Download it
5. Done! ✅

---

## 🎯 **THAT'S IT!**

Your site is live! 🎉

---

## 📋 **WHAT YOU GET**

✅ **3-Tier System:**
- 🆓 Free: 50 templates, 10 memes/day
- 🪙 WALDOCOIN: 150 templates, unlimited (auto if 1000+ WLO)
- 💎 Premium: 200+ templates, $5/month

✅ **Features:**
- XUMM wallet login
- Drag-and-drop text
- NFT integration
- Custom fonts & colors
- Download memes

---

## 🔑 **OPTIONAL: Get XUMM Keys**

For wallet login:
1. Go to https://apps.xumm.dev/
2. Create app
3. Copy keys
4. Add to backend .env
5. Restart backend

---

## 📞 **NEED MORE HELP?**

- **Full Guide**: See `DEPLOYMENT.md`
- **All Features**: See `PRODUCTION_READY.md`
- **Implementation**: See `IMPLEMENTATION_SUMMARY.md`

---

## 🎉 **READY TO LAUNCH!**

Just upload and go! 🚀

