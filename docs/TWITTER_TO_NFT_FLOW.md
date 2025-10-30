# 🐦 Twitter to NFT Conversion Flow

**How WALDOCOIN captures Twitter posts and converts them to NFTs**

---

## 📊 Complete Data Flow

```
Twitter Post
    ↓
Twitter API (Bearer Token)
    ↓
Extract: Text, Image, Engagement Metrics
    ↓
Store in Redis (Meme Data)
    ↓
Calculate XP & Rewards
    ↓
User Mints NFT (50 WALDO payment)
    ↓
Upload to IPFS (Image + Metadata)
    ↓
Create NFT on XRPL
    ↓
NFT Listed on Marketplace
```

---

## 🔍 Step 1: Twitter Data Capture

### Source: `waldo-twitter-bot/main.py` & `waldocoin-backend/utils/scan_user.js`

**What Gets Captured:**
```javascript
{
  tweet_id: "1234567890",
  text: "Check out this meme! #WaldoMeme",
  image_url: "https://pbs.twimg.com/media/...",
  likes: 150,
  retweets: 45,
  created_at: "2025-10-29T12:00:00Z",
  author_id: "user123",
  handle: "@username"
}
```

### How It Works:

1. **Twitter Bot Scans** - Looks for tweets with `#WaldoMeme` hashtag
2. **API Call** - Uses Twitter API v2 with Bearer Token
3. **Extract Media** - Gets image URL from tweet attachments
4. **Get Metrics** - Captures likes, retweets, engagement

### Code Example:
```javascript
// From scan_user.js
const tweet = await fetch(`https://api.twitter.com/2/users/${userId}/tweets`, {
  headers: { "Authorization": `Bearer ${BEARER_TOKEN}` }
});

// Extract data
const mediaUrl = tweet?.includes?.media?.[0]?.url;
const likes = tweet?.data?.public_metrics?.like_count;
const retweets = tweet?.data?.public_metrics?.retweet_count;
```

---

## 💾 Step 2: Store in Redis

### Storage Structure:

```
Key: meme:{tweet_id}
Value: {
  author_id: "user123",
  handle: "@username",
  text: "Check out this meme! #WaldoMeme",
  likes: 150,
  retweets: 45,
  created_at: "2025-10-29T12:00:00Z",
  wallet: "rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz",
  tier: "gold",
  waldo: 500,
  xp: 10,
  claimed: 0,
  reward_type: "instant",
  image_url: "https://pbs.twimg.com/media/..."
}
```

### Additional Indexes:
```
wallet:tweets:{wallet} → Set of tweet IDs
meme:xp:{tweet_id} → XP value
meme:waldo:{tweet_id} → WALDO reward
meme:nft_minted:{tweet_id} → false/true
meme:ai_verified:{tweet_id} → true/false
```

---

## 🧮 Step 3: Calculate XP & Rewards

### XP Calculation (Whitepaper Compliant):
```javascript
function calculateXp(likes, retweets) {
  const xpFromLikes = Math.floor(likes / 25);      // 1 XP per 25 likes
  const xpFromRetweets = Math.floor(retweets / 15); // 1 XP per 15 retweets
  const totalXp = xpFromLikes + xpFromRetweets;
  return Math.min(totalXp, 10);                     // Cap at 10 XP
}
```

### Reward Calculation:
```javascript
function calculateRewards(likes, retweets, rewardType) {
  const engagementScore = (likes * 0.6) + (retweets * 1.4);
  
  if (engagementScore >= 500) return { tier: 'gold', waldo: 500 };
  if (engagementScore >= 300) return { tier: 'silver', waldo: 300 };
  if (engagementScore >= 100) return { tier: 'bronze', waldo: 100 };
  return { tier: 'common', waldo: 50 };
}
```

---

## 🎨 Step 4: User Mints NFT

### Frontend Flow (my-nfts.html):

1. **User Selects Tweet** - Chooses from their captured tweets
2. **Clicks "Mint NFT"** - Initiates minting process
3. **Pays 500 WALDO** - Via XUMM wallet
4. **Backend Confirms** - Verifies payment on XRPL

### Backend: `waldocoin-backend/routes/mint.js`

```javascript
// Create XUMM payment payload
const paymentPayload = {
  txjson: {
    TransactionType: "Payment",
    Destination: process.env.DISTRIBUTOR_WALLET,
    Amount: {
      currency: "WLO",
      issuer: process.env.WALDO_ISSUER,
      value: "500"  // 500 WALDO cost
    }
  },
  custom_meta: {
    identifier: `MINT:${tweetId}`,
    instruction: "Pay 500 WALDO to mint your meme NFT"
  }
};

// Subscribe to payment
await xummClient.payload.createAndSubscribe(paymentPayload, (event) => {
  return event.data.signed === true;
});
```

---

## 📤 Step 5: Upload to IPFS

### Backend: `waldocoin-backend/routes/mint/confirm.js`

**What Gets Uploaded:**
```json
{
  "name": "WALDO Meme NFT",
  "description": "WALDO Meme NFT - Verified via XP system",
  "image": "ipfs://QmXxxx.../image.jpg",
  "attributes": [
    { "trait_type": "Likes", "value": 150 },
    { "trait_type": "Retweets", "value": 45 },
    { "trait_type": "XP", "value": 10 },
    { "trait_type": "Rarity", "value": "Rare" }
  ]
}
```

### Code:
```javascript
const metadataUrl = await uploadToIPFS({
  tweetId,
  wallet,
  description: "WALDO Meme NFT - Verified via XP system",
  image: `https://waldocoin.live/wp-content/uploads/memes/${tweetId}.jpg`
});
```

---

## ⛓️ Step 6: Create NFT on XRPL

### NFTokenMint Transaction:

```javascript
const tx = {
  TransactionType: "NFTokenMint",
  Account: walletInstance.classicAddress,
  URI: xrpl.convertStringToHex(metadataUrl),  // IPFS URL
  Flags: 8,  // Burnable
  NFTokenTaxon: 0
};

// Submit to XRPL
const result = await client.submitAndWait(tx);
```

**Result:**
- NFT created on XRPL blockchain
- Stored in user's wallet
- Metadata on IPFS
- Immutable record

---

## 🏪 Step 7: List on Marketplace

### Frontend: `WordPress/marketplace.html`

**User Can:**
1. View their minted NFTs
2. Set price in WALDO
3. List for sale
4. Buyers can purchase
5. Creator gets 5% royalty on resales

### Backend: `waldocoin-backend/routes/marketplace.js`

```javascript
// List NFT
POST /api/marketplace/list
{
  wallet: "rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz",
  nftId: "nft_1234567890",
  tweetId: "1234567890",
  price: 100,
  currency: "WALDO"
}

// Response
{
  listingId: "listing_xyz",
  nftId: "nft_1234567890",
  price: 100,
  currency: "WALDO",
  royaltyRate: 0.05,
  createdAt: "2025-10-29T12:00:00Z"
}
```

---

## 📊 Data Structure Summary

### Redis Keys Used:

| Key | Purpose | Example |
|-----|---------|---------|
| `meme:{tweet_id}` | Tweet metadata | `meme:1234567890` |
| `wallet:tweets:{wallet}` | User's tweets | `wallet:tweets:rN7n...` |
| `meme:xp:{tweet_id}` | XP value | `meme:xp:1234567890` |
| `meme:waldo:{tweet_id}` | WALDO reward | `meme:waldo:1234567890` |
| `meme:nft_minted:{tweet_id}` | Mint status | `meme:nft_minted:1234567890` |
| `marketplace:listing:{id}` | Listing data | `marketplace:listing:xyz` |
| `marketplace:seller:{wallet}` | User's listings | `marketplace:seller:rN7n...` |

---

## 🔐 Security & Verification

### AI Content Verification:
```javascript
// Stored in Redis
meme:ai_verified:{tweet_id} → true/false
meme:ai_confidence:{tweet_id} → 0.95
```

### Fraud Prevention:
- Twitter handle linked to wallet (one-time)
- XP system prevents fake engagement
- AI verification checks content
- XRPL immutable record

---

## 🎯 Complete User Journey

1. **Link Twitter** → User connects Twitter handle to wallet
2. **Post Meme** → User posts with `#WaldoMeme` hashtag
3. **Bot Captures** → Twitter bot finds and stores tweet data
4. **Earn Rewards** → User gets XP and WALDO based on engagement
5. **Reach 60+ XP** → Meme must have at least 60 XP to be eligible
6. **Mint NFT** → User pays 500 WALDO to mint NFT
7. **Own NFT** → NFT stored in user's XRPL wallet
8. **List for Sale** → User lists NFT on marketplace
9. **Buyer Purchases** → Buyer pays WALDO, gets NFT
10. **Creator Royalty** → Original creator gets 5% on resale

---

## 📝 Key Files

- **Twitter Bot:** `waldo-twitter-bot/main.py`
- **Scan User:** `waldocoin-backend/utils/scan_user.js`
- **Mint Route:** `waldocoin-backend/routes/mint.js`
- **Mint Confirm:** `waldocoin-backend/routes/mint/confirm.js`
- **Marketplace:** `waldocoin-backend/routes/marketplace.js`
- **IPFS Upload:** `waldocoin-backend/utils/ipfsUploader.js`
- **Frontend:** `WordPress/my-nfts.html`, `WordPress/marketplace.html`

---

*Last Updated: October 29, 2025*

