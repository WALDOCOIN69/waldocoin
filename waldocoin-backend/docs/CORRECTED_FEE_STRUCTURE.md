# 💰 CORRECTED WALDOCOIN FEE STRUCTURE

**Last Updated:** 2025-11-21

---

## 🎯 **BATTLE ARENA FEES**

### **Entry Fees:**
| Action | Fee (WLO) | Destination Tag |
|--------|-----------|-----------------|
| **Start Battle** | **150,000 WLO** | 777 |
| **Accept Battle** | **75,000 WLO** | 778 |
| **Vote** | **30,000 WLO** | 779 |

### **NFT Holder Benefits:**
- **Discount applies to FEES, not entry amounts**
- Silver (1-2 NFTs): 5% fee discount
- Gold (3-9 NFTs): 10% fee discount
- Platinum (10+ NFTs): 15% fee discount
- KING NFT: 25% fee discount

**Example:**
- Start battle base fee: 150,000 WLO
- Gold holder (10% discount): Pays 135,000 WLO
- KING holder (25% discount): Pays 112,500 WLO

---

## 💎 **STAKING FEES**

### **Long-Term Staking:**
| Action | Fee | Distribution |
|--------|-----|--------------|
| **Stake** | **2%** of staked amount | Deducted upfront |
| **Early Unstake** | **15%** penalty | On principal + rewards |

**Example:**
- User stakes 10,000 WLO
- 2% fee = 200 WLO
- Actual staked amount = 9,800 WLO
- Rewards calculated on 9,800 WLO

### **Per-Meme Staking:**
| Action | Fee |
|--------|-----|
| **Stake** | **5%** of staked amount |
| **Instant Claim** | **10%** of reward |

---

## 📊 **FEE DISTRIBUTION (ALL FEES)**

### **Utility Pool & Burn:**
| Destination | Percentage | Eligible Holders |
|-------------|------------|------------------|
| **NFT Holder Utility Pool** | **Variable** | 3+ NFTs only (Gold, Platinum, KING) |
| **Burned** | **0.25%** | Deflationary mechanism |
| **Platform** | **Remainder** | Treasury |

**DISCLAIMER:** Utility pool allocations are discretionary, variable, non-guaranteed, and do not represent revenue sharing or investment returns.

**Applies to:**
- ✅ Claim fees (5-10% of allocation)
- ✅ Staking allocations
- ✅ Battle fees
- ✅ All platform fees

---

## 🖼️ **NFT SECONDARY SALES**

| Action | Fee | Destination |
|--------|-----|-------------|
| **Secondary NFT Sale** | **2%** royalty | Utility Pool (3+ NFTs only) |

---

## 💰 **CLAIM FEES**

| Method | Fee Rate | Distribution |
|--------|----------|--------------|
| **Instant Claim** | **10%** | Utility Pool, 0.25% → Burn, Remainder → Platform |
| **Staked Claim** (30 days) | **5%** | Utility Pool, 0.25% → Burn, Remainder → Platform |

---

## 🎨 **MEMEOLOGY FEES**

| Tier | Fee per Meme |
|------|--------------|
| FREE | None (5 memes/day limit) |
| WALDOCOIN (1000+ WLO) | **0.1 WLO** |
| PREMIUM ($5/month) | None |
| GOLD (3-9 NFTs) | None |
| PLATINUM (10+ NFTs) | None |
| KING NFT | None |

---

## 🏛️ **NFT MINTING**

| Action | Fee |
|--------|-----|
| **Mint NFT** | **500 WLO** |
| **Minimum Balance** | ~3 XRP worth of WLO |

---

## 🗳️ **DAO VOTING**

| Action | Requirement |
|--------|-------------|
| **Vote** | **50,000 WLO** (1 vote per 50K held) |

---

## 🎰 **MONTHLY LOTTERY SYSTEM (NOT REVENUE SHARING)**

**LEGAL NOTICE:** This is a prize drawing/giveaway, NOT revenue sharing or profit distribution. No purchase necessary beyond NFT ownership. NFT ownership = automatic lottery entry. This does not constitute an investment or security.

### **Monthly Drawing:**
- **5 random winners** selected from all NFT holders
- **KING holders** are **GUARANTEED winners** (split 50% of pool)
- Lottery winners split remaining 50% equally

### **Lottery Tickets:**
| Tier | Tickets Per NFT | Example |
|------|-----------------|---------|
| 🥈 **Silver (1-2 NFTs)** | 1 ticket | 2 NFTs = 2 tickets |
| 🥇 **Gold (3-9 NFTs)** | 2 tickets | 5 NFTs = 10 tickets |
| 💎 **Platinum (10+ NFTs)** | 3 tickets | 12 NFTs = 36 tickets |
| 👑 **KING NFT** | N/A | **AUTO-WINNER** |

### **Prize Pool:**
- Variable based on platform activity (non-guaranteed)
- 0.25% of all fees burned as deflationary mechanism
- Pool size varies month to month
- Past winners may win again

---

## 🔥 **BURN MECHANISMS**

| Source | Burn Amount |
|--------|-------------|
| **All Fees** | **0.25%** of fee amount |
| **Claim Fees** | 0.25% of 5-10% fee |
| **Staking Rewards** | 0.25% of rewards |
| **Battle Fees** | 0.25% of 150K/75K/30K fees |

**Total Burn:** Continuous deflationary pressure

---

## ✅ **IMPLEMENTATION STATUS**

### **Updated Files:**
- ✅ `waldocoin-backend/utils/config.js` - Battle fees: 150K/75K/30K
- ✅ `waldocoin-backend/utils/config.js` - Long-term staking: 2% fee
- ✅ `waldocoin-backend/utils/config.js` - Fee distribution: 10% revenue, 0.25% burn
- ✅ `waldocoin-backend/routes/claim.js` - Updated fee distribution
- ✅ `waldocoin-backend/routes/staking.js` - Added 2% long-term staking fee
- ✅ `waldocoin-backend/routes/staking.js` - Updated revenue share to 10%
- ✅ `waldocoin-backend/routes/tokenomics.js` - Updated all fee structures
- ✅ `waldocoin-backend/utils/nftUtilities.js` - Added revenue share documentation

---

## 📝 **NOTES**

1. **NFT holder discounts apply to FEES, not entry amounts**
2. **Revenue share only for 3+ NFT holders (Gold, Platinum, KING)**
3. **Silver tier (1-2 NFTs) gets XP boost and fee discounts but NO revenue share**
4. **All fees contribute 10% to revenue pool and 0.25% to burn**
5. **Long-term staking now has 2% upfront fee (changed from 0%)**

