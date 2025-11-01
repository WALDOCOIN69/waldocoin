# 🪙 MINTING WALLET SETUP GUIDE

**Date:** October 31, 2025  
**Purpose:** Set up the NFT minting wallet for WALDOCOIN  
**Status:** ACTION REQUIRED

---

## 📋 Overview

The `MINTING_WALLET_SECRET` is required to sign NFT minting transactions on the XRPL. This guide will help you set it up.

---

## 🎯 What You Need

The `MINTING_WALLET_SECRET` is an XRPL wallet seed that:
- Starts with the letter `s` (e.g., `sEd7rBGm5kxzauRTAV2hbsa...`)
- Has sufficient XRP for transaction fees (minimum 10 XRP recommended)
- Has a trustline to the WALDO token (WLO)
- Can be the same as your distributor wallet or a separate dedicated wallet

---

## 🔧 Option 1: Generate a New Minting Wallet

### Step 1: Generate a New Wallet

Use the admin endpoint to generate a new wallet:

```bash
curl -X POST https://waldocoin-backend.onrender.com/api/admin/new-wallet \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "address": "rN7n7otQDd6FczFgLdlqtyMVrn3Rqq...",
  "seed": "sEd7rBGm5kxzauRTAV2hbsa...",
  "note": "Fund with >= 12 XRP for base reserve & trustline..."
}
```

### Step 2: Fund the Wallet

1. Send at least 12 XRP to the generated address
2. Wait for confirmation on XRPL

### Step 3: Add WLO Trustline

Use XUMM or another XRPL wallet to add a trustline to the WALDO token:
- **Issuer:** `rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY`
- **Currency:** `WLO`
- **Limit:** 1,000,000 (or your preferred limit)

### Step 4: Save the Seed

The seed from Step 1 is your `MINTING_WALLET_SECRET`

---

## 🔧 Option 2: Use Your Existing Distributor Wallet

If you already have a distributor wallet with sufficient XRP and a WLO trustline, you can use its seed:

```bash
# Your existing distributor wallet seed
MINTING_WALLET_SECRET=sEd7rBGm5kxzauRTAV2hbsa...
```

---

## 📝 Add to Local Environment

### Step 1: Add to `.env` File

Edit `waldocoin-backend/.env`:

```bash
# NFT Minting Configuration
MINTING_WALLET_SECRET=sEd7rBGm5kxzauRTAV2hbsa...
```

### Step 2: Verify Locally

Test that the wallet works:

```bash
cd waldocoin-backend
npm install
node -e "
import xrpl from 'xrpl';
const wallet = xrpl.Wallet.fromSeed(process.env.MINTING_WALLET_SECRET);
console.log('✅ Wallet loaded:', wallet.classicAddress);
"
```

---

## 🚀 Add to Render Production

### Step 1: Go to Render Dashboard

1. Visit https://dashboard.render.com
2. Select the **waldo-api** service
3. Click on **Environment** tab

### Step 2: Add the Secret

1. Click **Add Environment Variable**
2. **Key:** `MINTING_WALLET_SECRET`
3. **Value:** Your wallet seed (starts with 's')
4. Click **Save**

### Step 3: Redeploy

1. Go to **Deploys** tab
2. Click **Deploy latest commit**
3. Wait for deployment to complete

### Step 4: Verify

Check the logs to confirm:
```
✅ MINTING_WALLET_SECRET loaded
🔍 Minting wallet (public): rN7n7otQDd6FczFgLdlqtyMVrn3Rqq...
```

---

## ✅ Verification Checklist

- [ ] Wallet seed obtained (starts with 's')
- [ ] Wallet has at least 10 XRP
- [ ] Wallet has WLO trustline
- [ ] Added to local `.env` file
- [ ] Added to Render environment
- [ ] Render service redeployed
- [ ] Logs show wallet loaded successfully
- [ ] Test NFT minting works

---

## 🧪 Test NFT Minting

### Step 1: Create a Test Meme

1. Go to https://waldocoin.live
2. Create a new meme
3. Pay 50 WALDO to mint as NFT

### Step 2: Check Transaction

1. Go to https://xrpscan.com
2. Search for your wallet address
3. Verify NFTokenMint transaction appears

### Step 3: Verify NFT

1. Check your XRPL wallet
2. Confirm NFT appears in your account

---

## 🔐 Security Notes

- ⚠️ **NEVER** commit the seed to git
- ⚠️ **NEVER** share the seed publicly
- ⚠️ **NEVER** log the seed in console
- ✅ Always use environment variables
- ✅ Use `sync: false` in render.yaml
- ✅ Rotate seeds periodically

---

## 🆘 Troubleshooting

### Error: "Invalid seed"
- Verify seed starts with 's'
- Verify seed is correct length (20-29 characters)
- Check for extra spaces or characters

### Error: "Insufficient XRP"
- Send more XRP to the wallet
- Minimum 10 XRP recommended
- Account reserve is 10 XRP

### Error: "No trustline to WLO"
- Add WLO trustline to the wallet
- Use XUMM or another XRPL wallet
- Issuer: `rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY`

### NFT Minting Fails
- Check wallet has sufficient XRP for fees
- Verify WLO trustline exists
- Check logs for detailed error message
- Verify MINTING_WALLET_SECRET is set correctly

---

## 📞 Support

If you need help:
1. Check the logs in Render dashboard
2. Verify wallet on https://xrpscan.com
3. Test with a small amount first
4. Contact support with error details

---

## 📚 Related Documentation

- [MISSING_SECRETS_AUDIT.md](./MISSING_SECRETS_AUDIT.md) - Secrets audit report
- [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md) - Security audit
- [render.yaml](../render.yaml) - Render configuration

---

**Setup Date:** October 31, 2025  
**Status:** Ready for configuration  
**Next Step:** Add MINTING_WALLET_SECRET to Render

