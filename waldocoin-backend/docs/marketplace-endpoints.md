# 🏪 WALDOCOIN NFT Marketplace API Documentation

## Overview
Complete NFT marketplace implementation for WALDO ecosystem. Users can mint memes as NFTs, list them for sale, browse listings, and purchase with WALDO tokens.

## Base URL
```
https://waldocoin-backend.onrender.com/api/marketplace
```

---

## 📊 Endpoints

### 1. **GET /stats** - Marketplace Statistics
Get overall marketplace metrics and recent sales.

**Response:**
```json
{
  "success": true,
  "stats": {
    "activeListings": 42,
    "totalSales": 156,
    "totalVolume": "12450.50",
    "averagePrice": "79.81",
    "totalListingsEver": 200,
    "totalValueListed": "15800.00"
  }
}
```

---

### 2. **GET /listings** - Browse All Listings
Get paginated marketplace listings with filtering and sorting.

**Query Parameters:**
- `page` (default: 1) - Page number
- `limit` (default: 20) - Items per page
- `rarity` - Filter by rarity (Common, Uncommon, Rare, Epic, Legendary)
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter
- `sortBy` - Sort option (newest, price_low, price_high, rarity, engagement)

**Response:**
```json
{
  "success": true,
  "listings": [
    {
      "listingId": "listing_1729...",
      "nftId": "nft_123",
      "tweetId": "tweet_456",
      "seller": "rN7n7otQDd6FczFgLdlqtyMVrn...",
      "price": 100,
      "currency": "WALDO",
      "title": "Funny Meme #42",
      "imageUrl": "https://...",
      "rarity": "Rare",
      "rarityColor": "#2196F3",
      "rarityMultiplier": 2.0,
      "likes": 1250,
      "retweets": 450,
      "xp": 5000,
      "createdAt": "2025-10-28T12:00:00Z",
      "royaltyRate": 0.05,
      "originalCreator": "rOriginalWallet..."
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalListings": 100,
    "hasNext": true,
    "hasPrev": false
  },
  "filters": {
    "rarities": ["Common", "Uncommon", "Rare", "Epic", "Legendary"],
    "sortOptions": ["newest", "price_low", "price_high", "rarity", "engagement"]
  }
}
```

---

### 3. **POST /list** - List NFT for Sale
List a minted NFT on the marketplace.

**Request Body:**
```json
{
  "wallet": "rN7n7otQDd6FczFgLdlqtyMVrn...",
  "nftId": "nft_123",
  "tweetId": "tweet_456",
  "price": 100,
  "currency": "WALDO"
}
```

**Response:**
```json
{
  "success": true,
  "message": "NFT listed successfully",
  "listing": {
    "listingId": "listing_1729...",
    "nftId": "nft_123",
    "price": 100,
    "currency": "WALDO",
    "royaltyRate": 0.05,
    "createdAt": "2025-10-28T12:00:00Z"
  }
}
```

---

### 4. **POST /buy** - Purchase NFT
Initiate NFT purchase with XUMM payment.

**Request Body:**
```json
{
  "wallet": "rBuyerWallet...",
  "listingId": "listing_1729..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Complete payment to purchase NFT",
  "purchase": {
    "listingId": "listing_1729...",
    "price": 100,
    "royaltyAmount": 5,
    "sellerAmount": 95,
    "paymentUuid": "uuid-here",
    "qr": "https://...",
    "deepLink": "https://xumm.app/..."
  }
}
```

---

### 5. **POST /confirm-purchase** - Confirm Purchase
Confirm NFT purchase after XUMM payment completion.

**Request Body:**
```json
{
  "wallet": "rBuyerWallet...",
  "listingId": "listing_1729...",
  "paymentUuid": "uuid-here"
}
```

**Response:**
```json
{
  "success": true,
  "message": "NFT purchase completed successfully",
  "sale": {
    "nftId": "nft_123",
    "buyer": "rBuyerWallet...",
    "seller": "rSellerWallet...",
    "price": 100,
    "royaltyPaid": 5,
    "completedAt": "2025-10-28T12:05:00Z"
  }
}
```

---

### 6. **GET /my-listings/:wallet** - User's Listings
Get all marketplace listings for a specific wallet.

**Query Parameters:**
- `status` (default: all) - Filter by status (active, sold, delisted)

**Response:**
```json
{
  "success": true,
  "listings": [...],
  "total": 5
}
```

---

### 7. **DELETE /delist** - Remove Listing
Remove NFT from marketplace.

**Request Body:**
```json
{
  "wallet": "rSellerWallet...",
  "listingId": "listing_1729..."
}
```

---

### 8. **POST /favorite** - Toggle Favorite
Add or remove NFT from user's favorites.

**Request Body:**
```json
{
  "wallet": "rUserWallet...",
  "listingId": "listing_1729..."
}
```

**Response:**
```json
{
  "success": true,
  "action": "added",
  "message": "Added to favorites"
}
```

---

### 9. **GET /listing/:listingId** - Listing Details
Get detailed information about a specific listing.

**Response:**
```json
{
  "success": true,
  "listing": {
    "listingId": "listing_1729...",
    "nftId": "nft_123",
    "title": "Funny Meme #42",
    "imageUrl": "https://...",
    "price": 100,
    "currency": "WALDO",
    "seller": "rSellerWallet...",
    "status": "active",
    "views": 42,
    "favorites": 8,
    "likes": 1250,
    "retweets": 450,
    "xp": 5000,
    "rarity": "Rare",
    "royaltyRate": 0.05,
    "originalCreator": "rOriginalWallet..."
  }
}
```

---

## 🔄 Marketplace Flow

1. **Mint NFT** - User mints meme as NFT (via `/api/mint`)
2. **List for Sale** - User lists NFT with price (`POST /list`)
3. **Browse** - Other users browse marketplace (`GET /listings`)
4. **Purchase** - Buyer initiates purchase (`POST /buy`)
5. **Confirm** - After XUMM payment, confirm purchase (`POST /confirm-purchase`)
6. **Ownership Transfer** - NFT ownership updated, royalties paid

---

## 💰 Royalty System

- **Original Creator**: 5% royalty on resales
- **Seller**: Receives 95% of sale price
- **Buyer**: Pays full listing price

---

## 🎨 Rarity Calculation

Based on engagement metrics:
- **Legendary**: Score ≥ 10,000 (5x multiplier)
- **Epic**: Score ≥ 5,000 (3x multiplier)
- **Rare**: Score ≥ 1,000 (2x multiplier)
- **Common**: Score < 1,000 (1x multiplier)

Score = (likes × 0.6) + (retweets × 1.4) + (xp × 10) × (1 + age_bonus)

---

## ✅ Status: COMPLETE
All marketplace endpoints implemented and tested. Ready for production.

