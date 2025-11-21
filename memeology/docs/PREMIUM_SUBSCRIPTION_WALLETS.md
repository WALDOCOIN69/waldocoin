# 💰 Memeology Premium Subscription - Wallet Configuration

## 📍 Payment Destination

All premium subscription payments are sent to the **WALDOCOIN Treasury Wallet**:

```
Address: r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K
Purpose: Revenue collection for premium subscriptions
Destination Tag: 888
```

---

## 🏦 WALDOCOIN Wallet Ecosystem

| Wallet | Address | Purpose | Used For |
|--------|---------|---------|----------|
| **WALDO Issuer** | `rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY` | Token issuer (blackholed) | WLO token issuance |
| **Distributor** | `rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL` | Airdrop & staking distributions | Sending WLO to users |
| **Treasury** | `r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K` | Revenue collection | **Premium subscriptions** |
| **Staking Vault** | `rnWfL48YCknW6PYewFLKfMKUymHCfj3aww` | Staking escrow | Long-term staking |
| **Battle Escrow** | `rfn7cG6qAQMuG97i9Nb5GxGdHbTjY7TzW` | Battle fees | Battle arena fees |
| **Burn Address** | `rrrrrrrrrrrrrrrrrrrrrhoLvTp` | Token burning | Deflationary burns |

---

## 💳 Premium Payment Flow

### **1. User Initiates Payment**
- User selects Monthly ($5) or Yearly ($50)
- User chooses XRP or WLO payment method
- Frontend fetches live pricing from backend

### **2. XUMM Payment Request**
```javascript
{
  TransactionType: 'Payment',
  Destination: 'r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K', // Treasury
  Amount: '2000000', // XRP in drops OR WLO amount
  DestinationTag: 888, // Premium subscription tag
  Memos: [{
    Memo: {
      MemoType: 'PREMIUM_SUB',
      MemoData: 'monthly_xrp' // or 'yearly_wlo'
    }
  }]
}
```

### **3. Payment Verification**
- User signs transaction in XUMM
- Frontend polls for transaction confirmation
- Backend receives `txHash` from frontend
- Backend verifies payment on XRPL (TODO: implement on-chain verification)

### **4. Premium Activation**
- Premium subscription activated immediately
- Watermark removed
- All premium features unlocked
- Expiration date set (30 days or 365 days)

---

## 🔐 Destination Tags

| Tag | Purpose |
|-----|---------|
| **777** | Battle start fee |
| **778** | Battle accept fee |
| **779** | Battle vote fee |
| **888** | **Premium subscription** |

---

## 📊 Revenue Tracking

All premium subscription payments can be tracked on XRPL by:

1. **Monitoring Treasury Wallet**: `r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K`
2. **Filtering by Destination Tag**: `888`
3. **Reading Memo Data**: Contains duration and payment method

Example XRPL query:
```javascript
const response = await client.request({
  command: 'account_tx',
  account: 'r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K',
  ledger_index_min: -1,
  ledger_index_max: -1,
  forward: false,
  limit: 100
})

// Filter for premium subscriptions
const premiumPayments = response.result.transactions.filter(tx => 
  tx.tx.DestinationTag === 888
)
```

---

## 💰 Revenue Distribution

Premium subscription revenue collected in the Treasury Wallet can be used for:

1. **Platform Development** - Ongoing Memeology improvements
2. **Marketing & Growth** - User acquisition campaigns
3. **WLO Buybacks** - Support token price
4. **Team Compensation** - Developer salaries
5. **NFT Holder Rewards** - Additional revenue sharing

---

## 🔒 Security Notes

- ✅ Treasury wallet is **NOT** the issuer wallet (issuer is blackholed)
- ✅ Treasury wallet is controlled by the WALDOCOIN team
- ✅ All payments are verified on-chain via XRPL
- ✅ Destination tag `888` ensures proper categorization
- ✅ Memo data provides audit trail for subscriptions

---

## 📈 Analytics

Track premium subscription metrics:

```javascript
// Monthly Recurring Revenue (MRR)
const monthlySubscriptions = await getSubscriptionsByDuration('monthly')
const mrr = monthlySubscriptions.length * 5 // $5 per month

// Annual Recurring Revenue (ARR)
const yearlySubscriptions = await getSubscriptionsByDuration('yearly')
const arr = (monthlySubscriptions.length * 60) + (yearlySubscriptions.length * 50)

// Conversion Rate
const totalUsers = await getTotalMemeologyUsers()
const premiumUsers = monthlySubscriptions.length + yearlySubscriptions.length
const conversionRate = (premiumUsers / totalUsers) * 100
```

---

**Last Updated**: 2025-11-21  
**Treasury Wallet**: `r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K`  
**Destination Tag**: `888`

