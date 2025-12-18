// routes/marketplace.js - NFT Marketplace for WALDO ecosystem
import express from 'express';
import { redis } from '../redisClient.js';
import { xummClient } from '../utils/xummClient.js';
import getWaldoBalance from '../utils/getWaldoBalance.js';

const router = express.Router();

// ✅ Calculate NFT rarity based on engagement metrics
function calculateNFTRarity(likes, retweets, xp, age) {
  const engagementScore = (likes * 0.6) + (retweets * 1.4) + (xp * 10);
  const ageBonus = Math.min(age / (30 * 24 * 60 * 60 * 1000), 2); // Max 2x for 30+ days old
  const totalScore = engagementScore * (1 + ageBonus);

  if (totalScore >= 10000) return { rarity: 'Legendary', multiplier: 5.0, color: '#FFD700' };
  if (totalScore >= 5000) return { rarity: 'Epic', multiplier: 3.0, color: '#9C27B0' };
  if (totalScore >= 2000) return { rarity: 'Rare', multiplier: 2.0, color: '#2196F3' };
  if (totalScore >= 500) return { rarity: 'Uncommon', multiplier: 1.5, color: '#4CAF50' };
  return { rarity: 'Common', multiplier: 1.0, color: '#9E9E9E' };
}

// ✅ GET /api/marketplace/stats - Get marketplace statistics
router.get('/stats', async (req, res) => {
  try {
    // Get basic marketplace stats from Redis
    const totalListings = await redis.get('marketplace:total_listings') || '0';
    const totalValue = await redis.get('marketplace:total_value') || '0';

    // Count active listings
    const activeListingKeys = await redis.keys('marketplace:listing:*');
    let activeListings = 0;
    let totalSales = 0;
    let totalVolume = 0;
    let prices = [];

    for (const key of activeListingKeys) {
      try {
        const listingData = await redis.hGetAll(key);

        if (listingData.status === 'active') {
          activeListings++;
          prices.push(parseFloat(listingData.price));
        } else if (listingData.status === 'sold') {
          totalSales++;
          totalVolume += parseFloat(listingData.finalPrice || listingData.price);
        }
      } catch (error) {
        continue;
      }
    }

    // Calculate average price
    const averagePrice = prices.length > 0
      ? (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(2)
      : '0';

    res.json({
      success: true,
      stats: {
        activeListings,
        totalSales,
        totalVolume: totalVolume.toFixed(2),
        averagePrice,
        totalListingsEver: parseInt(totalListings),
        totalValueListed: parseFloat(totalValue).toFixed(2)
      }
    });

  } catch (error) {
    console.error('❌ Error fetching marketplace stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace statistics'
    });
  }
});

// ✅ GET /api/marketplace/listings - Get all active NFT listings
router.get('/listings', async (req, res) => {
  try {
    const { page = 1, limit = 20, rarity, minPrice, maxPrice, sortBy = 'newest' } = req.query;

    // Get all active listings
    const listingKeys = await redis.keys('marketplace:listing:*');
    const listings = [];

    for (const key of listingKeys) {
      try {
        const listingData = await redis.hGetAll(key);

        if (listingData.status === 'active') {
          // Get meme data for rarity calculation
          const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);
          const rarityInfo = calculateNFTRarity(
            parseInt(memeData.likes) || 0,
            parseInt(memeData.retweets) || 0,
            parseInt(memeData.xp) || 0,
            Date.now() - new Date(memeData.created_at).getTime()
          );

          // Get deposit/base value for this NFT
          const depositAmount = await redis.get(`nft:deposit:${listingData.tweetId}`) || 10000;

          const listing = {
            listingId: listingData.listingId,
            nftId: listingData.nftId,
            tweetId: listingData.tweetId,
            seller: listingData.seller,
            price: parseFloat(listingData.price),
            currency: listingData.currency,
            title: memeData.text?.substring(0, 100) || 'Untitled Meme',
            imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
            rarity: rarityInfo.rarity,
            rarityColor: rarityInfo.color,
            rarityMultiplier: rarityInfo.multiplier,
            likes: parseInt(memeData.likes) || 0,
            retweets: parseInt(memeData.retweets) || 0,
            xp: parseInt(memeData.xp) || 0,
            createdAt: listingData.createdAt,
            royaltyRate: parseFloat(listingData.royaltyRate) || 0.05,
            originalCreator: memeData.wallet,
            deposit: parseInt(depositAmount),
            twitterHandle: memeData.twitter_handle || null
          };

          // Apply filters
          if (rarity && listing.rarity.toLowerCase() !== rarity.toLowerCase()) continue;
          if (minPrice && listing.price < parseFloat(minPrice)) continue;
          if (maxPrice && listing.price > parseFloat(maxPrice)) continue;

          listings.push(listing);
        }
      } catch (error) {
        console.error(`Error processing listing ${key}:`, error);
      }
    }

    // Sort listings
    switch (sortBy) {
      case 'price_low':
        listings.sort((a, b) => a.price - b.price);
        break;
      case 'price_high':
        listings.sort((a, b) => b.price - a.price);
        break;
      case 'rarity':
        listings.sort((a, b) => b.rarityMultiplier - a.rarityMultiplier);
        break;
      case 'engagement':
        listings.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
        break;
      default: // newest
        listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedListings = listings.slice(startIndex, endIndex);

    res.json({
      success: true,
      listings: paginatedListings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(listings.length / limit),
        totalListings: listings.length,
        hasNext: endIndex < listings.length,
        hasPrev: page > 1
      },
      filters: {
        rarities: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'],
        sortOptions: ['newest', 'price_low', 'price_high', 'rarity', 'engagement']
      }
    });

  } catch (error) {
    console.error('❌ Error fetching marketplace listings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace listings'
    });
  }
});

// ✅ POST /api/marketplace/list - List an NFT for sale
router.post('/list', async (req, res) => {
  try {
    const { wallet, nftId, tweetId, price, currency = 'WALDO' } = req.body;

    if (!wallet || !nftId || !tweetId || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: wallet, nftId, tweetId, price'
      });
    }

    // Validate price
    const listingPrice = parseFloat(price);
    if (isNaN(listingPrice) || listingPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid price. Must be a positive number.'
      });
    }

    // Check if NFT exists and is owned by user
    const nftExists = await redis.get(`meme:nft_minted:${tweetId}`);
    if (!nftExists || nftExists === 'false') {
      return res.status(404).json({
        success: false,
        error: 'NFT not found or not minted'
      });
    }

    // Check if already listed
    const existingListing = await redis.get(`marketplace:nft:${nftId}`);
    if (existingListing) {
      return res.status(409).json({
        success: false,
        error: 'NFT is already listed for sale'
      });
    }

    // Get meme data for royalty calculation
    const memeData = await redis.hGetAll(`meme:${tweetId}`);
    const originalCreator = memeData.wallet;
    const royaltyRate = wallet === originalCreator ? 0 : 0.05; // 5% royalty if not original creator

    // Create listing
    const listingId = `listing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const listingData = {
      listingId,
      nftId,
      tweetId,
      seller: wallet,
      price: listingPrice,
      currency,
      status: 'active',
      createdAt: new Date().toISOString(),
      royaltyRate,
      originalCreator,
      views: 0,
      favorites: 0
    };

    // Store listing
    await redis.hSet(`marketplace:listing:${listingId}`, listingData);
    await redis.set(`marketplace:nft:${nftId}`, listingId); // Quick lookup
    await redis.sAdd(`marketplace:seller:${wallet}`, listingId); // Seller's listings
    await redis.sAdd('marketplace:active_listings', listingId); // All active listings

    // Update marketplace stats
    await redis.incr('marketplace:total_listings');
    await redis.incrByFloat('marketplace:total_value', listingPrice);

    console.log(`🏪 NFT listed for sale: ${nftId} by ${wallet} for ${listingPrice} ${currency}`);

    res.json({
      success: true,
      message: 'NFT listed successfully',
      listing: {
        listingId,
        nftId,
        price: listingPrice,
        currency,
        royaltyRate,
        createdAt: listingData.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Error listing NFT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list NFT for sale'
    });
  }
});

// ✅ POST /api/marketplace/buy - Purchase an NFT
router.post('/buy', async (req, res) => {
  try {
    const { wallet, listingId } = req.body;

    if (!wallet || !listingId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: wallet, listingId'
      });
    }

    // Get listing data
    const listingData = await redis.hGetAll(`marketplace:listing:${listingId}`);

    if (!listingData || Object.keys(listingData).length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (listingData.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Listing is no longer active'
      });
    }

    if (listingData.seller === wallet) {
      return res.status(400).json({
        success: false,
        error: 'Cannot buy your own NFT'
      });
    }

    const price = parseFloat(listingData.price);
    const royaltyRate = parseFloat(listingData.royaltyRate) || 0;
    const royaltyAmount = price * royaltyRate;
    const sellerAmount = price - royaltyAmount;

    // Check buyer's WALDO balance
    const buyerBalance = await getWaldoBalance(wallet);
    if (buyerBalance < price) {
      return res.status(400).json({
        success: false,
        error: `Insufficient WALDO balance. Need ${price} WALDO, have ${buyerBalance} WALDO`
      });
    }

    // Create XUMM payment for NFT purchase
    const payload = {
      TransactionType: 'Payment',
      Destination: listingData.seller,
      Amount: {
        currency: 'WLO',
        issuer: process.env.WALDO_ISSUER,
        value: sellerAmount.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('NFT_PURCHASE').toString('hex').toUpperCase(),
          MemoData: Buffer.from(`Buy NFT ${listingData.nftId} for ${price} WALDO`).toString('hex').toUpperCase()
        }
      }]
    };

    const { created } = await xummClient.payload.create(payload);

    // Store pending purchase
    await redis.hSet(`marketplace:purchase:${listingId}`, {
      buyer: wallet,
      seller: listingData.seller,
      price,
      royaltyAmount,
      sellerAmount,
      paymentUuid: created.uuid,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Complete payment to purchase NFT',
      purchase: {
        listingId,
        price,
        royaltyAmount,
        sellerAmount,
        paymentUuid: created.uuid,
        qr: created.refs.qr_png,
        deepLink: created.next.always
      }
    });

  } catch (error) {
    console.error('❌ Error purchasing NFT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate NFT purchase'
    });
  }
});

// ✅ POST /api/marketplace/confirm-purchase - Confirm NFT purchase after payment
router.post('/confirm-purchase', async (req, res) => {
  try {
    const { wallet, listingId, paymentUuid } = req.body;

    if (!wallet || !listingId || !paymentUuid) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Get purchase data
    const purchaseData = await redis.hGetAll(`marketplace:purchase:${listingId}`);

    if (!purchaseData || purchaseData.buyer !== wallet) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found'
      });
    }

    // Get listing data
    const listingData = await redis.hGetAll(`marketplace:listing:${listingId}`);

    // Process royalty payment if applicable
    if (parseFloat(purchaseData.royaltyAmount) > 0) {
      const royaltyPayload = {
        TransactionType: 'Payment',
        Destination: listingData.originalCreator,
        Amount: {
          currency: 'WLO',
          issuer: process.env.WALDO_ISSUER,
          value: purchaseData.royaltyAmount
        },
        Memos: [{
          Memo: {
            MemoType: Buffer.from('NFT_ROYALTY').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`Royalty for NFT ${listingData.nftId}`).toString('hex').toUpperCase()
          }
        }]
      };

      await xummClient.payload.create(royaltyPayload);
    }

    // Update listing status
    await redis.hSet(`marketplace:listing:${listingId}`, {
      status: 'sold',
      buyer: wallet,
      soldAt: new Date().toISOString(),
      finalPrice: purchaseData.price
    });

    // Update NFT ownership
    await redis.set(`nft:owner:${listingData.nftId}`, wallet);

    // Remove from active listings
    await redis.sRem('marketplace:active_listings', listingId);
    await redis.del(`marketplace:nft:${listingData.nftId}`);

    // Update seller's listings
    await redis.sRem(`marketplace:seller:${listingData.seller}`, listingId);

    // Update buyer's collection
    await redis.sAdd(`marketplace:collection:${wallet}`, listingData.nftId);

    // Update marketplace stats
    await redis.incr('marketplace:total_sales');
    await redis.incrByFloat('marketplace:total_volume', parseFloat(purchaseData.price));

    // Clean up purchase data
    await redis.del(`marketplace:purchase:${listingId}`);

    console.log(`🎉 NFT sale completed: ${listingData.nftId} sold to ${wallet} for ${purchaseData.price} WALDO`);

    res.json({
      success: true,
      message: 'NFT purchase completed successfully',
      sale: {
        nftId: listingData.nftId,
        buyer: wallet,
        seller: listingData.seller,
        price: parseFloat(purchaseData.price),
        royaltyPaid: parseFloat(purchaseData.royaltyAmount),
        completedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error confirming NFT purchase:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm NFT purchase'
    });
  }
});

// ✅ GET /api/marketplace/my-listings/:wallet - Get user's marketplace listings
router.get('/my-listings/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const { status = 'all' } = req.query;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallet address'
      });
    }

    // Get user's listing IDs
    const listingIds = await redis.sMembers(`marketplace:seller:${wallet}`);
    const listings = [];

    for (const listingId of listingIds) {
      try {
        const listingData = await redis.hGetAll(`marketplace:listing:${listingId}`);

        if (listingData && Object.keys(listingData).length > 0) {
          // Filter by status if specified
          if (status !== 'all' && listingData.status !== status) {
            continue;
          }

          // Get meme data for additional info
          const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);

          listings.push({
            listingId: listingData.listingId,
            nftId: listingData.nftId,
            tweetId: listingData.tweetId,
            title: memeData.text ? memeData.text.substring(0, 100) + '...' : 'WALDO Meme NFT',
            imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
            price: parseFloat(listingData.price),
            currency: listingData.currency || 'WALDO',
            status: listingData.status,
            createdAt: listingData.createdAt,
            views: parseInt(listingData.views) || 0,
            favorites: parseInt(listingData.favorites) || 0,
            likes: parseInt(memeData.likes) || 0,
            retweets: parseInt(memeData.retweets) || 0,
            xp: parseInt(memeData.xp) || 0
          });
        }
      } catch (error) {
        console.error(`Error processing listing ${listingId}:`, error);
        continue;
      }
    }

    // Sort by creation date (newest first)
    listings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      listings,
      total: listings.length
    });

  } catch (error) {
    console.error('❌ Error fetching user listings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user listings'
    });
  }
});

// ✅ DELETE /api/marketplace/delist - Remove NFT from marketplace
router.delete('/delist', async (req, res) => {
  try {
    const { wallet, listingId } = req.body;

    if (!wallet || !listingId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: wallet, listingId'
      });
    }

    // Get listing data
    const listingData = await redis.hGetAll(`marketplace:listing:${listingId}`);

    if (!listingData || Object.keys(listingData).length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (listingData.seller !== wallet) {
      return res.status(403).json({
        success: false,
        error: 'Only the seller can delist this NFT'
      });
    }

    // Update listing status
    await redis.hSet(`marketplace:listing:${listingId}`, {
      status: 'delisted',
      delistedAt: new Date().toISOString()
    });

    // Remove from active listings
    await redis.sRem('marketplace:active_listings', listingId);
    await redis.del(`marketplace:nft:${listingData.nftId}`);
    await redis.sRem(`marketplace:seller:${wallet}`, listingId);

    console.log(`🗑️ NFT delisted: ${listingData.nftId} by ${wallet}`);

    res.json({
      success: true,
      message: 'NFT delisted successfully',
      listingId
    });

  } catch (error) {
    console.error('❌ Error delisting NFT:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delist NFT'
    });
  }
});



// ✅ POST /api/marketplace/favorite - Add/remove NFT from favorites
router.post('/favorite', async (req, res) => {
  try {
    const { wallet, listingId } = req.body;

    if (!wallet || !listingId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: wallet, listingId'
      });
    }

    // Check if already favorited
    const isFavorited = await redis.sIsMember(`marketplace:favorites:${wallet}`, listingId);

    if (isFavorited) {
      // Remove from favorites
      await redis.sRem(`marketplace:favorites:${wallet}`, listingId);
      await redis.hIncrBy(`marketplace:listing:${listingId}`, 'favorites', -1);

      res.json({
        success: true,
        action: 'removed',
        message: 'Removed from favorites'
      });
    } else {
      // Add to favorites
      await redis.sAdd(`marketplace:favorites:${wallet}`, listingId);
      await redis.hIncrBy(`marketplace:listing:${listingId}`, 'favorites', 1);

      res.json({
        success: true,
        action: 'added',
        message: 'Added to favorites'
      });
    }

  } catch (error) {
    console.error('❌ Error toggling favorite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update favorites'
    });
  }
});

// ✅ GET /api/marketplace/listing/:listingId - Get single listing details
router.get('/listing/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;

    // Get listing data
    const listingData = await redis.hGetAll(`marketplace:listing:${listingId}`);

    if (!listingData || Object.keys(listingData).length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Get meme data
    const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);

    // Calculate rarity
    const rarityInfo = calculateNFTRarity(
      parseInt(memeData.likes) || 0,
      parseInt(memeData.retweets) || 0,
      parseInt(memeData.xp) || 0,
      Date.now() - new Date(memeData.created_at).getTime()
    );

    // Increment view count
    await redis.hIncrBy(`marketplace:listing:${listingId}`, 'views', 1);

    const listing = {
      listingId: listingData.listingId,
      nftId: listingData.nftId,
      tweetId: listingData.tweetId,
      title: memeData.text || 'WALDO Meme NFT',
      imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
      price: parseFloat(listingData.price),
      currency: listingData.currency || 'WALDO',
      seller: listingData.seller,
      status: listingData.status,
      createdAt: listingData.createdAt,
      views: parseInt(listingData.views) + 1,
      favorites: parseInt(listingData.favorites) || 0,
      likes: parseInt(memeData.likes) || 0,
      retweets: parseInt(memeData.retweets) || 0,
      xp: parseInt(memeData.xp) || 0,
      rarity: rarityInfo.rarity,
      rarityMultiplier: rarityInfo.multiplier,
      royaltyRate: parseFloat(listingData.royaltyRate) || 0,
      originalCreator: listingData.originalCreator
    };

    res.json({
      success: true,
      listing
    });

  } catch (error) {
    console.error('❌ Error fetching listing details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch listing details'
    });
  }
});

// ✅ GET /api/marketplace/activity - Get recent marketplace activity
router.get('/activity', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const activity = [];

    // Get recent sales from completed listings
    const listingKeys = await redis.keys('marketplace:listing:*');

    for (const key of listingKeys) {
      try {
        const listingData = await redis.hGetAll(key);

        if (listingData.status === 'sold' && listingData.soldAt) {
          const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);
          activity.push({
            type: 'sale',
            listingId: listingData.listingId,
            nftId: listingData.nftId,
            title: memeData.text?.substring(0, 50) || 'Meme NFT',
            imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
            price: parseFloat(listingData.price),
            seller: listingData.seller,
            buyer: listingData.buyer,
            timestamp: listingData.soldAt
          });
        } else if (listingData.status === 'active') {
          const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);
          activity.push({
            type: 'listing',
            listingId: listingData.listingId,
            nftId: listingData.nftId,
            title: memeData.text?.substring(0, 50) || 'Meme NFT',
            imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
            price: parseFloat(listingData.price),
            seller: listingData.seller,
            timestamp: listingData.createdAt
          });
        }
      } catch (e) {
        // Skip invalid entries
      }
    }

    // Sort by timestamp (newest first)
    activity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      activity: activity.slice(0, parseInt(limit))
    });

  } catch (error) {
    console.error('❌ Error fetching marketplace activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace activity'
    });
  }
});

// ✅ GET /api/marketplace/search - Search NFTs by text
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    const searchTerm = q.toLowerCase();
    const listingKeys = await redis.keys('marketplace:listing:*');
    const results = [];

    for (const key of listingKeys) {
      try {
        const listingData = await redis.hGetAll(key);

        if (listingData.status === 'active') {
          const memeData = await redis.hGetAll(`meme:${listingData.tweetId}`);
          const memeText = (memeData.text || '').toLowerCase();
          const twitterHandle = (memeData.twitter_handle || '').toLowerCase();

          // Check if search term matches text or twitter handle
          if (memeText.includes(searchTerm) || twitterHandle.includes(searchTerm)) {
            const depositAmount = await redis.get(`nft:deposit:${listingData.tweetId}`) || 10000;
            const rarityInfo = calculateNFTRarity(
              parseInt(memeData.likes) || 0,
              parseInt(memeData.retweets) || 0,
              parseInt(memeData.xp) || 0,
              Date.now() - new Date(memeData.created_at).getTime()
            );

            results.push({
              listingId: listingData.listingId,
              nftId: listingData.nftId,
              tweetId: listingData.tweetId,
              seller: listingData.seller,
              price: parseFloat(listingData.price),
              title: memeData.text?.substring(0, 100) || 'Untitled Meme',
              imageUrl: memeData.image_url || 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
              rarity: rarityInfo.rarity,
              likes: parseInt(memeData.likes) || 0,
              retweets: parseInt(memeData.retweets) || 0,
              xp: parseInt(memeData.xp) || 0,
              deposit: parseInt(depositAmount),
              twitterHandle: memeData.twitter_handle || null
            });
          }
        }
      } catch (e) {
        // Skip invalid entries
      }
    }

    res.json({
      success: true,
      query: q,
      results: results.slice(0, parseInt(limit)),
      totalResults: results.length
    });

  } catch (error) {
    console.error('❌ Error searching marketplace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search marketplace'
    });
  }
});

export default router;
