# 🚀 NFT Utilities Implementation Guide

**Quick start guide for integrating NFT utilities into WALDOCOIN**

---

## 📦 Files Created

### Backend Files
- `waldocoin-backend/utils/nftUtilities.js` - Core utility functions
- `waldocoin-backend/routes/nftUtilities.js` - API endpoints

### Documentation
- `WALDO_NFT_UTILITIES_GUIDE.md` - Complete user guide
- `NFT_UTILITIES_IMPLEMENTATION.md` - This file

---

## 🔧 Integration Steps

### Step 1: Register Routes in Server

Add to `waldocoin-backend/server.js`:

```javascript
import nftUtilitiesRouter from "./routes/nftUtilities.js";

// ... other imports ...

// Register NFT utilities routes
app.use("/api/nft-utilities", nftUtilitiesRouter);
```

### Step 2: Update Meme XP Calculation

In `waldocoin-backend/routes/claim.js` or wherever XP is awarded:

```javascript
import { applyHolderXPBoost } from "../utils/nftUtilities.js";

// When awarding XP:
const baseXP = calculateXP(likes, retweets); // existing logic
const boostedResult = await applyHolderXPBoost(wallet, baseXP);
const finalXP = boostedResult.boostedXP;

// Store final XP
await redis.set(`meme:xp:${tweetId}`, finalXP);
```

### Step 3: Update Claim Fee Logic

In `waldocoin-backend/routes/claim.js`:

```javascript
import { applyClaimFeeDiscount } from "../utils/nftUtilities.js";

// When calculating claim fee:
const baseFee = amount * 0.10; // 10% instant claim fee
const discountResult = await applyClaimFeeDiscount(wallet, baseFee);
const finalFee = discountResult.discountedFee;

// Apply final fee
const claimAmount = amount - finalFee;
```

### Step 4: Update Battle Entry

In `waldocoin-backend/routes/battle.js`:

```javascript
import { 
  canAccessHolderBattle, 
  getHolderBattleDiscount 
} from "../utils/nftUtilities.js";

// Check access:
const hasAccess = await canAccessHolderBattle(wallet);
if (!hasAccess) {
  return res.status(403).json({ 
    success: false, 
    error: "Need 1+ NFT to access Holder Battles" 
  });
}

// Apply discount:
const baseFee = 100; // 100 WALDO entry
const discount = await getHolderBattleDiscount(wallet);
const finalFee = baseFee * (1 - discount);
```

### Step 5: Update Staking APY

In `waldocoin-backend/routes/staking.js`:

```javascript
import { getStakingBoost } from "../utils/nftUtilities.js";

// When calculating staking rewards:
const baseAPY = 0.10; // 10%
const boost = await getStakingBoost(wallet);
const finalAPY = baseAPY + boost;

// Calculate rewards with final APY
const yearlyReward = stakedAmount * finalAPY;
```

### Step 6: Add Reward Pool Funding

In `waldocoin-backend/routes/claim.js` (when processing claims):

```javascript
import { addToHolderRewardPool } from "../utils/nftUtilities.js";

// When processing a claim, add 2% to holder pool:
const claimFee = amount * 0.10;
const poolContribution = claimFee * 0.20; // 20% of fees go to pool
await addToHolderRewardPool(poolContribution);
```

### Step 7: Setup Monthly Distribution

Create a cron job in `waldocoin-backend/cron/monthlyRewards.js`:

```javascript
import { distributeHolderRewards } from "../utils/nftUtilities.js";

// Run on 1st of each month at 00:00 UTC
export async function distributeMonthlyRewards() {
  console.log("🎁 Distributing monthly NFT holder rewards...");
  const result = await distributeHolderRewards();
  console.log("✅ Distribution complete:", result);
}

// In server.js, add:
import cron from "node-cron";
import { distributeMonthlyRewards } from "./cron/monthlyRewards.js";

// Run at 00:00 UTC on 1st of month
cron.schedule("0 0 1 * *", distributeMonthlyRewards);
```

---

## 📊 API Endpoints

### Get Holder Tier & Benefits
```
GET /api/nft-utilities/holder-tier/:wallet

Response:
{
  "success": true,
  "wallet": "rN7n7ot...",
  "nftCount": 5,
  "tier": "🥇 Gold",
  "tierLevel": "gold",
  "benefits": {
    "xpBoost": "+15%",
    "claimFeeDiscount": "10%",
    "rewardShares": 2,
    "votingPower": "125%",
    "stakingBoost": "+3% APY",
    "battleDiscount": "20% off"
  }
}
```

### Apply XP Boost
```
POST /api/nft-utilities/apply-xp-boost

Body:
{
  "wallet": "rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz",
  "baseXP": 10
}

Response:
{
  "success": true,
  "baseXP": 10,
  "boostedXP": 11,
  "boostPercentage": 15,
  "tier": "gold"
}
```

### Apply Fee Discount
```
POST /api/nft-utilities/apply-fee-discount

Body:
{
  "wallet": "rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz",
  "baseFee": 100
}

Response:
{
  "success": true,
  "baseFee": 100,
  "discountedFee": 90,
  "discountPercentage": 10,
  "tier": "gold"
}
```

### Get Leaderboard
```
GET /api/nft-utilities/leaderboard?limit=10

Response:
{
  "success": true,
  "leaderboard": [
    {
      "wallet": "rN7n7ot...",
      "nftCount": 15,
      "tier": "👑 Platinum",
      "shares": 5
    },
    ...
  ],
  "totalHolders": 42,
  "rewards": {
    "first": "500 WALDO + Hall of Fame",
    "second": "300 WALDO + Elite Badge",
    "third": "200 WALDO + VIP Badge"
  }
}
```

### Get Monthly Perks
```
GET /api/nft-utilities/monthly-perks/:wallet

Response:
{
  "success": true,
  "tier": "🥇 Gold",
  "perks": [
    "🎁 30% off minting fees",
    "⚡ Early access to features",
    "🏆 Leaderboard eligibility",
    "💎 Gold Discord role",
    "🎟️ Discounted battle entries"
  ],
  "claimed": false,
  "month": "2025-10"
}
```

### Get Voting Power
```
GET /api/nft-utilities/voting-power/:wallet

Response:
{
  "success": true,
  "wallet": "rN7n7ot...",
  "tier": "🥇 Gold",
  "votingPower": "125%",
  "multiplier": 1.25,
  "message": "✅ 125% voting boost"
}
```

### Get Staking Boost
```
GET /api/nft-utilities/staking-boost/:wallet

Response:
{
  "success": true,
  "wallet": "rN7n7ot...",
  "tier": "🥇 Gold",
  "apyBoost": "+3.0%",
  "example": {
    "baseAPY": "10%",
    "withBoost": "13.0%",
    "yearlyGain": "+300 WALDO on 10k stake"
  }
}
```

---

## 🗄️ Redis Keys Used

```
wallet:nft_count:{wallet}              # NFT count for wallet
wallet:pending_rewards:{wallet}        # Pending reward balance
wallet:perks_claimed:{wallet}:{month}  # Monthly perks claim status

nft:holder_reward_pool                 # Current reward pool
nft:holder_reward_pool:{month}         # Monthly pool accumulation
nft:last_distribution:{month}          # Last distribution details

analytics:xp_boosts:{wallet}           # XP boost usage count
analytics:xp_boosted_total:{wallet}    # Total XP boosted
analytics:nft_utility:{wallet}:{type}  # Utility usage tracking
```

---

## 🧪 Testing

### Test Holder Tier
```bash
curl http://localhost:3000/api/nft-utilities/holder-tier/rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz
```

### Test XP Boost
```bash
curl -X POST http://localhost:3000/api/nft-utilities/apply-xp-boost \
  -H "Content-Type: application/json" \
  -d '{"wallet":"rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz","baseXP":10}'
```

### Test Leaderboard
```bash
curl http://localhost:3000/api/nft-utilities/leaderboard?limit=10
```

---

## 📈 Monitoring

### Track Utility Usage
```javascript
// Automatically tracked in:
analytics:nft_utility:{wallet}:xp_boost
analytics:nft_utility:{wallet}:fee_discount
analytics:nft_utility:{wallet}:view_perks
analytics:nft_utility:{wallet}:claim_perks
```

### Monitor Reward Pool
```bash
# Check current pool
redis-cli GET nft:holder_reward_pool

# Check monthly accumulation
redis-cli GET nft:holder_reward_pool:2025-10
```

---

## 🔐 Security Considerations

1. **Wallet Validation** - All endpoints validate wallet format
2. **Admin Key** - Distribution endpoints require ADMIN_KEY
3. **Rate Limiting** - Add rate limits to prevent abuse
4. **Audit Trail** - All distributions logged to Redis
5. **Snapshot System** - Monthly snapshots prevent gaming

---

## 🚀 Launch Checklist

- [ ] Register routes in server.js
- [ ] Update XP calculation logic
- [ ] Update claim fee logic
- [ ] Update battle entry logic
- [ ] Update staking APY logic
- [ ] Add reward pool funding
- [ ] Setup monthly cron job
- [ ] Test all endpoints
- [ ] Deploy to production
- [ ] Monitor analytics
- [ ] Setup Discord integration
- [ ] Create dashboard widgets

---

## 📞 Support

For questions or issues:
- Check `WALDO_NFT_UTILITIES_GUIDE.md` for user documentation
- Review `waldocoin-backend/utils/nftUtilities.js` for function details
- Check `waldocoin-backend/routes/nftUtilities.js` for endpoint details

---

*Last Updated: October 29, 2025*
*Ready for Production*

