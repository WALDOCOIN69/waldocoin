// routes/memeology.js
// Memeology - AI-powered meme generator routes
import express from 'express';
import axios from 'axios';
import xrpl from 'xrpl';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { redis } from '../redisClient.js';
import { getAllPrices, calculateTokenAmount } from '../utils/priceOracle.js';
import {
  getTemplatesForTier,
  searchTemplates,
  getCategories,
  getRandomTemplate,
  getTemplateById,
  getTierStats,
  toImgflipFormat
} from '../utils/templateLoader.js';
import { uploadToIPFS } from '../utils/ipfsUploader.js';
import {
  trackMemeGeneration,
  trackMemeDownload,
  trackMemeShare,
  trackSession,
  updateSessionActivity,
  trackFeatureUsage
} from '../utils/analytics.js';

dotenv.config();

// Try to import sharp, but make it optional
let sharp = null;
try {
  const sharpModule = await import('sharp');
  sharp = sharpModule.default;
  console.log('✅ Sharp loaded successfully - watermarking enabled');
} catch (error) {
  console.warn('⚠️  Sharp not available - watermarking disabled:', error.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configuration
const IMGFLIP_USERNAME = process.env.IMGFLIP_USERNAME;
const IMGFLIP_PASSWORD = process.env.IMGFLIP_PASSWORD;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY; // Get free key at developers.giphy.com
const XRPL_SERVER = process.env.XRPL_SERVER || 'wss://s1.ripple.com'; // WebSocket for xrpl.js Client
const WLO_ISSUER = process.env.WLO_ISSUER || process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WLO_CURRENCY = 'WLO';
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Free Groq API key
// Public URL used when generating per-meme share links for the community gallery
const MEMEOLOGY_PUBLIC_URL = process.env.MEMEOLOGY_PUBLIC_URL || 'https://memeology.fun';
// Treasury wallet for premium subscription payments (can be overridden by env)
const TREASURY_WALLET = process.env.TREASURY_WALLET || 'r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K';

// 510 Redis-backed key helpers for Memeology
const MEMEOLOGY_KEYS = {
  premiumSubscription: (wallet) => `memeology:premium:${wallet}`,
  usageMeme: (wallet, date) => `memeology:usage:meme:${wallet}:${date}`,
  usageUpload: (wallet, date) => `memeology:usage:upload:${wallet}:${date}`,
  usageAi: (userKey, date) => `memeology:usage:ai:${userKey}:${date}`,
  communityList: 'memeology:community:memes',
  meme: (id) => `memeology:meme:${id}`,
  memeUpvotes: (id) => `memeology:meme:${id}:upvotes`,
  memeDownvotes: (id) => `memeology:meme:${id}:downvotes`
};

// Helper: load & persist premium subscription in Redis
async function getPremiumSubscription(wallet) {
  if (!wallet) return null;
  const key = MEMEOLOGY_KEYS.premiumSubscription(wallet);
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error parsing premium subscription from Redis for', wallet, err.message);
    return null;
  }
}

async function savePremiumSubscription(wallet, subscription) {
  if (!wallet || !subscription) return null;
  const key = MEMEOLOGY_KEYS.premiumSubscription(wallet);
  await redis.set(key, JSON.stringify(subscription));
  return subscription;
}


// Helper: Map Imgflip template IDs to Memegen template names
// Returns a slug string for known IDs or null for unknown ones.
function getMemgenTemplate(imgflipId) {
	const mapping = {
	  '181913649': 'drake',           // Drake Hotline Bling
	  '112126428': 'bf',              // Distracted Boyfriend
	  '87743020': 'buttons',          // Two Buttons
	  '129242436': 'cmm',             // Change My Mind
	  '100777631': 'iw',              // Is This A Pigeon (memegen uses 'iw')
	  '131087935': 'ants'             // Running Away Balloon (memegen uses 'ants')
	};
	return mapping[imgflipId] || null; // Unknown IDs handled elsewhere
}

// Helper: Send WLO rewards to meme creator
async function sendWLOReward(recipientWallet, amount, reason) {
  const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_WALLET_SECRET || process.env.WALDO_DISTRIBUTOR_SECRET;

  if (!DISTRIBUTOR_SECRET) {
    console.error('❌ DISTRIBUTOR_SECRET not configured - cannot send WLO rewards');
    return { success: false, error: 'Distributor wallet not configured' };
  }

  let client;
  try {
    client = new xrpl.Client(XRPL_SERVER);
    await client.connect();

    const distributorWallet = xrpl.Wallet.fromSeed(DISTRIBUTOR_SECRET);

    const payment = {
      TransactionType: 'Payment',
      Account: distributorWallet.classicAddress,
      Destination: recipientWallet,
      Amount: {
        currency: WLO_CURRENCY,
        issuer: WLO_ISSUER,
        value: amount.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('MEME_REWARD').toString('hex').toUpperCase(),
          MemoData: Buffer.from(reason).toString('hex').toUpperCase()
        }
      }]
    };

    const prepared = await client.autofill(payment);
    const signed = distributorWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      console.log(`✅ Sent ${amount} WLO to ${recipientWallet} - ${reason}`);
      console.log(`   TX Hash: ${result.result.hash}`);
      return {
        success: true,
        txHash: result.result.hash,
        amount,
        recipient: recipientWallet
      };
    } else {
      console.error(`❌ WLO reward transaction failed: ${result.result.meta.TransactionResult}`);
      return {
        success: false,
        error: result.result.meta.TransactionResult
      };
    }
  } catch (error) {
    console.error('❌ Error sending WLO reward:', error);
    return { success: false, error: error.message };
  } finally {
    if (client && client.isConnected()) {
      await client.disconnect();
    }
  }
}

// Helper: Get WLO balance from XRPL
async function getWLOBalance(wallet) {
  try {
    const client = new xrpl.Client(XRPL_SERVER);
    await client.connect();

    const response = await client.request({
      command: 'account_lines',
      account: wallet,
      ledger_index: 'validated'
    });

    await client.disconnect();

    console.log(`🔍 Checking WLO balance for ${wallet}`);
    console.log(`🎯 Looking for currency: ${WLO_CURRENCY}, issuer: ${WLO_ISSUER}`);
    console.log(`📊 Total trustlines: ${response.result.lines.length}`);

    // Log all trustlines for debugging
    response.result.lines.forEach(line => {
      console.log(`  - Currency: ${line.currency}, Issuer: ${line.account}, Balance: ${line.balance}`);
    });

    const wloLine = response.result.lines.find(
      line => line.currency === WLO_CURRENCY && line.account === WLO_ISSUER
    );

    console.log(`💰 WLO Line found:`, wloLine);
    const balance = wloLine ? parseFloat(wloLine.balance) : 0;
    console.log(`✅ Returning balance: ${balance}`);

    return balance;
  } catch (error) {
    console.error('❌ Error getting WLO balance:', error);
    return 0;
  }
}

// Helper: Get NFT count and check for KING NFTs
async function getNFTTier(wallet) {
  try {
    const client = new xrpl.Client(XRPL_SERVER);
    await client.connect();

    const nfts = await client.request({
      command: 'account_nfts',
      account: wallet,
      ledger_index: 'validated'
    });

    await client.disconnect();

    const nftCount = nfts.result.account_nfts?.length || 0;

    // Check for KING NFTs (specific NFT IDs or issuer)
    // TODO: Replace with actual KING NFT identifiers
    const kingNFTs = nfts.result.account_nfts?.filter(nft => {
      // Check if NFT is from WALDOCOIN collection
      // You can check by issuer, URI, or specific NFT IDs
      return nft.Issuer === WLO_ISSUER; // Adjust this logic based on your NFT collection
    }) || [];

    const hasKingNFT = kingNFTs.length > 0;
    const isPremiumTier = nftCount >= 10; // Premium tier: 10+ NFTs
    const isGoldTier = nftCount >= 3 && nftCount <= 9; // Gold tier: 3-9 NFTs

    console.log(`🖼️ NFT Check for ${wallet}: ${nftCount} NFTs, Gold (3-9): ${isGoldTier}, Premium (10+): ${isPremiumTier}, KING: ${hasKingNFT}`);

    return {
      nftCount,
      isGoldTier,
      isPremiumTier,
      hasKingNFT,
      kingNFTCount: kingNFTs.length
    };
  } catch (error) {
    console.error('❌ Error getting NFT tier:', error);
    return {
      nftCount: 0,
      isGoldTier: false,
      isPremiumTier: false,
      hasKingNFT: false,
      kingNFTCount: 0
    };
  }
}

// Helper: Check user tier
async function checkUserTier(wallet) {
  try {
    const wloBalance = await getWLOBalance(wallet);
    const nftTier = await getNFTTier(wallet);

    // Check premium subscription
    const now = new Date();
    let tier = 'free';
    let premiumExpires = null;

    const premiumSub = await getPremiumSubscription(wallet);
    if (premiumSub) {
      const expiresAt = new Date(premiumSub.expiresAt);
      const isActive = expiresAt > now && premiumSub.active !== false;
      if (isActive) {
        tier = 'premium';
        premiumExpires = premiumSub.expiresAt;
      }
    }

    // 🏆 KING NFT HOLDERS = UNLIMITED FREE ACCESS (highest priority)
    if (nftTier.hasKingNFT) {
      tier = 'king';
      console.log(`👑 KING NFT holder detected! Unlimited free access granted.`);
    }
    // 💎 PLATINUM TIER (10+ NFTs) = UNLIMITED FREE ACCESS
    else if (nftTier.isPremiumTier) {
      tier = 'platinum';
      console.log(`💎 Platinum NFT holder detected (${nftTier.nftCount} NFTs)! Unlimited free access granted.`);
    }
    // 🥇 GOLD TIER (3-9 NFTs) = UNLIMITED FREE ACCESS
    else if (nftTier.isGoldTier) {
      tier = 'gold';
      console.log(`🥇 Gold NFT holder detected (${nftTier.nftCount} NFTs)! Unlimited free access granted.`);
    }
    // 💵 PREMIUM SUBSCRIPTION ($5/month)
    else if (tier === 'premium') {
      tier = 'premium';
      console.log(`💵 Premium subscriber detected! Unlimited access.`);
    }
    // Check WLO balance for WALDOCOIN tier (if not premium/king/platinum/gold)
    else if (wloBalance >= 1000) {
      tier = 'waldocoin';
    }

    // Set features based on tier
    let features = {};

    // 👑 KING NFT HOLDERS - UNLIMITED EVERYTHING, NO FEES, CAN EARN WLO
    if (tier === 'king') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: 'unlimited',
        customFonts: true,
        noWatermark: true,
        nftArtIntegration: true,
        customUploads: 'unlimited',
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '👑 KING'
      };
    }
    // 💎 PLATINUM TIER (10+ NFTs) - UNLIMITED EVERYTHING, NO FEES, CAN EARN WLO
    else if (tier === 'platinum') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: 'unlimited',
        customFonts: true,
        noWatermark: true,
        nftArtIntegration: true,
        customUploads: 'unlimited',
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '💎 PLATINUM (10+ NFTs)'
      };
    }
    // 🥇 GOLD TIER (3-9 NFTs) - UNLIMITED EVERYTHING, NO FEES, CAN EARN WLO
    else if (tier === 'gold') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: 'unlimited',
        customFonts: true,
        noWatermark: true,
        nftArtIntegration: true,
        customUploads: 'unlimited',
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '🥇 GOLD (3-9 NFTs)'
      };
    }
    // 💵 PREMIUM SUBSCRIPTION ($5/month) - CAN EARN WLO
    else if (tier === 'premium') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: 'unlimited',
        customFonts: true,
        noWatermark: true,
        nftArtIntegration: true,
        customUploads: 'unlimited',
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '💵 PREMIUM'
      };
    }
    // 🪙 WALDOCOIN TIER (1000+ WLO) - CAN EARN WLO - HAS WATERMARK
    else if (tier === 'waldocoin') {
      features = {
        templates: 150,
        memesPerDay: 'unlimited',
        feePerMeme: '0.1 WLO',
        aiSuggestions: '10/day',
        customFonts: true,
        noWatermark: false,  // WALDOCOIN tier has watermark
        nftArtIntegration: true,
        customUploads: '50/day',
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '🪙 WALDOCOIN'
      };
    }
    // 🆓 FREE TIER - FULL TEMPLATE ACCESS, AI LIMITS ONLY, NO GIFS
    else {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: '1/day',
        customFonts: true,
        noWatermark: false,  // FREE tier has watermark
        nftArtIntegration: false,
        customUploads: 'unlimited',
        gifTemplates: 'none',
        communityGallery: true,
        canEarnWLO: false,
        badge: '🆓 FREE'
      };
    }

    return {
      tier,
      wallet,
      wloBalance,
      nftCount: nftTier.nftCount,
      hasKingNFT: nftTier.hasKingNFT,
      isGoldTier: nftTier.isGoldTier,
      isPlatinumTier: nftTier.isPremiumTier,
      premiumExpires,
      features
    };
  } catch (error) {
    console.error('Error checking user tier:', error);
    return {
      tier: 'free',
      wallet,
      wloBalance: 0,
      nftCount: 0,
      error: error.message
    };
  }
}

// GET /api/memeology/wallet/balance - Get WLO balance
router.get('/wallet/balance', async (req, res) => {
  try {
    const { wallet } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const wloBalance = await getWLOBalance(wallet);

    res.json({
      wallet,
      wloBalance,
      currency: WLO_CURRENCY,
      issuer: WLO_ISSUER
    });
  } catch (error) {
    console.error('Error in /wallet/balance:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/user/tier - Check user tier
router.get('/user/tier', async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const tierData = await checkUserTier(wallet);
    res.json(tierData);
  } catch (error) {
    console.error('Error in /user/tier:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/user/usage - Get user's meme creation count for today
router.get('/user/usage', async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const today = new Date().toISOString().split('T')[0];
    const key = MEMEOLOGY_KEYS.usageMeme(wallet, today);
    const raw = await redis.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;

    res.json({
      wallet,
      date: today,
      memesCreated: count
    });
  } catch (error) {
    console.error('Error in /user/usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/imgflip - Get meme templates from Imgflip
router.get('/templates/imgflip', async (req, res) => {
  try {
    const { tier } = req.query;
    const userTier = tier || 'free';

    const response = await axios.get('https://api.imgflip.com/get_memes');

    if (response.data.success) {
      const allMemes = response.data.data.memes;

      // Filter templates based on tier
      let templates = [];
      let templateLimit = 0;
      let upgradeMessage = '';
      let features = {};

      // 👑 KING, 💎 PLATINUM (10+ NFTs), 🥇 GOLD (3-9 NFTs) - UNLIMITED FREE ACCESS
      if (userTier === 'king' || userTier === 'platinum' || userTier === 'gold') {
        templates = allMemes; // All templates
        templateLimit = allMemes.length;

        if (userTier === 'king') {
          upgradeMessage = '👑 KING NFT HOLDER: Unlimited everything, no fees! You are royalty!';
        } else if (userTier === 'platinum') {
          upgradeMessage = '💎 PLATINUM NFT HOLDER (10+ NFTs): Unlimited everything, no fees! Thank you for your support!';
        } else {
          upgradeMessage = '🥇 GOLD NFT HOLDER (3-9 NFTs): Unlimited everything, no fees! Collect 10+ NFTs for Platinum tier!';
        }

        features = {
          templates: 'unlimited',
          memes_per_day: 'unlimited',
          fee_per_meme: 'none',
          ai_suggestions: 'unlimited',
          custom_fonts: true,
          no_watermark: true,
          nft_art_integration: true,
          custom_uploads: 'unlimited',
          gif_templates: 'unlimited',
          can_earn_wlo: true
        };
      }
      // 💵 PREMIUM SUBSCRIPTION ($5/month)
      else if (userTier === 'premium') {
        templates = allMemes; // All templates
        templateLimit = allMemes.length;
        upgradeMessage = '💵 PREMIUM SUBSCRIBER: Unlimited everything! Collect 3+ NFTs for free unlimited access!';
        features = {
          templates: 'unlimited',
          memes_per_day: 'unlimited',
          fee_per_meme: 'none',
          ai_suggestions: 'unlimited',
          custom_fonts: true,
          no_watermark: true,
          nft_art_integration: true,
          custom_uploads: 'unlimited',
          gif_templates: 'unlimited',
          can_earn_wlo: true
        };
      }
      // 🪙 WALDOCOIN TIER (1000+ WLO)
      else if (userTier === 'waldocoin') {
        templates = allMemes.slice(0, 150); // 150 templates
        templateLimit = 150;
        upgradeMessage = '🪙 WALDOCOIN Tier: 150 templates, unlimited memes/day, 0.1 WLO per meme. Collect 3+ NFTs for unlimited free access!';
        features = {
          templates: 150,
          memes_per_day: 'unlimited',
          fee_per_meme: '0.1 WLO',
          ai_suggestions: '10/day',
          custom_fonts: true,
          no_watermark: false,
          nft_art_integration: true,
          custom_uploads: '50/day',
          gif_templates: 'unlimited',
          can_earn_wlo: true
        };
      }
      // 🆓 FREE TIER - FULL TEMPLATE ACCESS, AI LIMITS ONLY
      else {
	        // Free tier now gets full template access - only AI features are limited
	        templates = allMemes;
	        templateLimit = allMemes.length;
        upgradeMessage = '🆓 Free Tier: All templates, unlimited memes! AI suggestions limited to 1/day. Upgrade for GIFs & more AI features!';
        features = {
          templates: 'unlimited',
          memes_per_day: 'unlimited',
          fee_per_meme: 'none',
          ai_suggestions: '1/day',
          custom_fonts: true,
          no_watermark: false,
          nft_art_integration: false,
          custom_uploads: 'unlimited',
          gif_templates: 'none',
          can_earn_wlo: false
        };
      }

	      console.log(`📋 Templates endpoint: tier=${userTier}, returning ${templates.length}/${allMemes.length} templates`);

	      // 🔁 Proxy template image URLs through our backend so Memeology's
	      // canvas can safely read pixels (for downloads & gallery sharing)
	      // without being blocked by third-party CORS restrictions.
	      const proxyBase = `${req.protocol}://${req.get('host')}/api/memeology/templates/proxy?url=`;
	      const proxiedTemplates = templates.map((meme) => ({
	        ...meme,
	        url: `${proxyBase}${encodeURIComponent(meme.url)}`
	      }));

	      res.json({
	        success: true,
	        memes: proxiedTemplates,
	        tier: userTier,
	        template_count: templates.length,
	        upgrade_message: upgradeMessage,
	        features: features
	      });
    } else {
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  } catch (error) {
    console.error('Error in /templates/imgflip:', error);
    res.status(500).json({ error: error.message });
  }
});

	// GET /api/memeology/templates/proxy - Proxy external template images so
	// they can be used in a canvas without CORS tainting (needed for
	// downloads and community sharing on memeology.fun).
	router.get('/templates/proxy', async (req, res) => {
	  try {
	    const { url } = req.query;

	    if (!url || typeof url !== 'string') {
	      return res.status(400).send('Missing or invalid url parameter');
	    }

	    // Basic safety: only allow http/https URLs
	    if (!/^https?:\/\//i.test(url)) {
	      return res.status(400).send('Invalid image URL');
	    }

	    const response = await axios.get(url, {
	      responseType: 'arraybuffer',
	      timeout: 15000
	    });

	    const contentType = response.headers['content-type'] || 'image/jpeg';
	    res.setHeader('Content-Type', contentType);
	    res.setHeader('Cache-Control', 'public, max-age=86400');

	    // Explicitly set CORS headers to allow canvas access from any origin.
	    // This overrides Helmet's restrictive Cross-Origin-Resource-Policy.
	    res.setHeader('Access-Control-Allow-Origin', '*');
	    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

	    return res.send(Buffer.from(response.data));
	  } catch (error) {
	    console.error('Error in /templates/proxy:', error.message || error);
	    return res.status(500).send('Failed to load template image');
	  }
	});

// GET /api/memeology/templates/giphy - Get GIF templates from Giphy
router.get('/templates/giphy', async (req, res) => {
  try {
    const { tier, limit = 50 } = req.query;
    const userTier = tier || 'free';

    // All tiers can access GIFs now (AI features only have limits)

    // Giphy API - trending GIFs
    const response = await axios.get('https://api.giphy.com/v1/gifs/trending', {
      params: {
        api_key: GIPHY_API_KEY,
        limit: limit,
        rating: 'pg-13' // Family-friendly content
      }
    });

    if (response.data.data) {
      const gifs = response.data.data.map(gif => ({
        id: gif.id,
        name: gif.title || 'Animated GIF',
        url: gif.images.fixed_height.url,
        original_url: gif.images.original.url,
        width: gif.images.original.width,
        height: gif.images.original.height,
        type: 'gif'
      }));

      console.log(`🎬 Giphy endpoint: tier=${userTier}, returning ${gifs.length} GIFs`);

      res.json({
        success: true,
        gifs: gifs,
        tier: userTier,
        count: gifs.length
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch GIFs from Giphy' });
    }
  } catch (error) {
    console.error('Error in /templates/giphy:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/user/nfts - Fetch user's NFTs from XRPL
router.get('/user/nfts', async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const client = new xrpl.Client(XRPL_SERVER);
    await client.connect();

    const nfts = await client.request({
      command: 'account_nfts',
      account: wallet,
      ledger_index: 'validated'
    });

    await client.disconnect();

    // Process NFTs and resolve metadata
    const processedNFTs = await Promise.all(
      (nfts.result.account_nfts || []).map(async (nft) => {
        let imageUrl = null;
        let name = 'Unknown NFT';

        try {
          if (nft.URI) {
            const uriHex = nft.URI;
            const uriString = Buffer.from(uriHex, 'hex').toString('utf8');

            let metadataUrl = uriString;
            if (uriString.startsWith('ipfs://')) {
              metadataUrl = uriString.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }

            const metadataResponse = await axios.get(metadataUrl, { timeout: 5000 });
            const metadata = metadataResponse.data;

            name = metadata.name || name;
            imageUrl = metadata.image || metadata.imageUrl;

            if (imageUrl && imageUrl.startsWith('ipfs://')) {
              imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }
          }
        } catch (error) {
          console.error('Error processing NFT metadata:', error.message);
        }

        return {
          nftId: nft.NFTokenID,
          name,
          imageUrl,
          issuer: nft.Issuer,
          uri: nft.URI
        };
      })
    );

    res.json({
      wallet,
      nfts: processedNFTs.filter(nft => nft.imageUrl) // Only return NFTs with images
    });
  } catch (error) {
    console.error('Error in /user/nfts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/memes/create - Create a meme
router.post('/memes/create', async (req, res) => {
  try {
    const { templateId, textTop, textBottom, userId } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'Template ID required' });
    }

    let tier = 'free';
    let wloBalance = 0;

    // Check user tier if userId (wallet) is provided
    if (userId) {
      const tierData = await checkUserTier(userId);
      tier = tierData.tier;
      wloBalance = tierData.wloBalance;

      // Free tier now has unlimited meme generation - no limits!

      // Check payment for WALDOCOIN tier
      if (tier === 'waldocoin') {
        if (wloBalance < 0.1) {
          return res.status(402).json({
            error: `Insufficient WLO balance. Need 0.1 WLO, have ${wloBalance} WLO`
          });
        }
        // TODO: Verify actual payment transaction hash
        // TODO: Deduct 0.1 WLO from balance (would be done via XRPL transaction)
      }
    }

    // Create meme using Imgflip API
    const response = await axios.post('https://api.imgflip.com/caption_image', null, {
      params: {
        template_id: templateId,
        username: IMGFLIP_USERNAME,
        password: IMGFLIP_PASSWORD,
        text0: textTop || '',
        text1: textBottom || ''
      }
    });

    if (response.data.success) {
      // Track usage
      if (userId) {
        const today = new Date().toISOString().split('T')[0];
        const key = MEMEOLOGY_KEYS.usageMeme(userId, today);
        await redis.incr(key);
      }

      const feeCharged = tier === 'waldocoin' ? '0.1 WLO' : 'none';

      res.json({
        success: true,
        imageUrl: response.data.data.url,
        pageUrl: response.data.data.page_url,
        tier,
        feeCharged,
        wloBalance
      });
    } else {
      res.status(400).json({ error: response.data.error_message || 'Failed to create meme' });
    }
  } catch (error) {
    console.error('Error in /memes/create:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/community/share - Share meme to community gallery
router.post('/community/share', async (req, res) => {
  try {
    const { wallet, memeUrl, templateName, caption } = req.body;

    if (!wallet || !memeUrl) {
      return res.status(400).json({ error: 'Wallet and meme URL required' });
    }

    const meme = {
      id: `meme_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      wallet,
      memeUrl,
      templateName: templateName || 'Custom Meme',
      caption: caption || '',
      createdAt: new Date().toISOString(),
      upvotes: 0,
      downvotes: 0
    };

    // Generate a stable, sharable URL for this specific meme so tweets can
    // deep-link directly into the gallery. We use a query param instead of a
    // path segment so static hosting/CDN setups keep working.
    const publicUrl = `${MEMEOLOGY_PUBLIC_URL}/?memeId=${encodeURIComponent(meme.id)}`;
    const memeWithUrl = { ...meme, publicUrl };

    // Persist meme in Redis and push to the community list (newest first)
    const memeKey = MEMEOLOGY_KEYS.meme(meme.id);
    await redis.set(memeKey, JSON.stringify(memeWithUrl));
    await redis.lPush(MEMEOLOGY_KEYS.communityList, meme.id);

    console.log(`🎨 Meme shared to community: ${meme.id} by ${wallet.slice(0, 10)}...`);

    res.json({
      success: true,
      meme: memeWithUrl,
      message: 'Meme shared to community gallery!'
    });
  } catch (error) {
    console.error('Error in /community/share:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/community/gallery - Get community memes
router.get('/community/gallery', async (req, res) => {
  try {
    const { limit = 50, sort = 'recent' } = req.query;

    const numericLimit = Math.min(parseInt(limit, 10) || 50, 200);

    const total = await redis.lLen(MEMEOLOGY_KEYS.communityList);
    if (!total) {
      return res.json({ success: true, memes: [], total: 0 });
    }

    // Get the most recent meme IDs
    const memeIds = await redis.lRange(MEMEOLOGY_KEYS.communityList, 0, numericLimit - 1);
    if (!memeIds || memeIds.length === 0) {
      return res.json({ success: true, memes: [], total });
    }

    const memeKeys = memeIds.map(id => MEMEOLOGY_KEYS.meme(id));
    const rawMemes = await redis.mGet(memeKeys);

    const memes = [];
    rawMemes.forEach(raw => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        memes.push(parsed);
      } catch (e) {
        console.error('Error parsing meme from Redis:', e.message);
      }
    });

    // Sort by upvotes or recent
    if (sort === 'top') {
      memes.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    }

    res.json({
      success: true,
      memes,
      total
    });
  } catch (error) {
    console.error('Error in /community/gallery:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/community/meme/:id - Get a single meme by ID
router.get('/community/meme/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Meme ID required' });
    }

    const memeKey = MEMEOLOGY_KEYS.meme(id);
    const raw = await redis.get(memeKey);

    if (!raw) {
      return res.status(404).json({ error: 'Meme not found or may have expired' });
    }

    let meme;
    try {
      meme = JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing meme JSON for /community/meme:', e.message);
      return res.status(500).json({ error: 'Failed to parse stored meme data' });
    }

    res.json({ success: true, meme });
  } catch (error) {
    console.error('Error in /community/meme/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/community/vote - Upvote/downvote a meme
router.post('/community/vote', async (req, res) => {
  try {
    const { wallet, memeId, voteType } = req.body; // voteType: 'up' or 'down'

    if (!wallet || !memeId || !voteType) {
      return res.status(400).json({ error: 'Wallet, meme ID, and vote type required' });
    }

    const memeKey = MEMEOLOGY_KEYS.meme(memeId);
    const rawMeme = await redis.get(memeKey);
    if (!rawMeme) {
      return res.status(404).json({ error: 'Meme not found' });
    }

    let meme;
    try {
      meme = JSON.parse(rawMeme);
    } catch (e) {
      console.error('Error parsing meme in /community/vote:', e.message);
      return res.status(500).json({ error: 'Failed to parse stored meme data' });
    }

    const upKey = MEMEOLOGY_KEYS.memeUpvotes(memeId);
    const downKey = MEMEOLOGY_KEYS.memeDownvotes(memeId);

    // Remove previous vote if exists
    await Promise.all([
      redis.sRem(upKey, wallet),
      redis.sRem(downKey, wallet)
    ]);

    // Add new vote
    if (voteType === 'up') {
      await redis.sAdd(upKey, wallet);
    } else if (voteType === 'down') {
      await redis.sAdd(downKey, wallet);
    }

    // Get updated counts
    const [upvoteCount, downvoteCount] = await Promise.all([
      redis.sCard(upKey),
      redis.sCard(downKey)
    ]);

    meme.upvotes = upvoteCount;
    meme.downvotes = downvoteCount;

    // Award WLO for viral memes (only if meme creator is not free tier)
    // Check meme creator's tier
    const creatorTier = await checkUserTier(meme.wallet);

    if (creatorTier.features.canEarnWLO) {
      if (meme.upvotes >= 1000 && !meme.rewarded1000) {
        meme.rewarded1000 = true;
        console.log(`🏆 Meme ${memeId} reached 1000 upvotes! Sending 10 WLO to ${meme.wallet} (${creatorTier.tier} tier)`);

        // Send 10 WLO reward
        const rewardResult = await sendWLOReward(
          meme.wallet,
          10,
          `Viral meme reward: 1000 upvotes - Meme ID: ${memeId}`
        );

        if (rewardResult.success) {
          meme.reward1000TxHash = rewardResult.txHash;
          console.log(`✅ 1000 upvote reward sent! TX: ${rewardResult.txHash}`);
        } else {
          console.error(`❌ Failed to send 1000 upvote reward: ${rewardResult.error}`);
        }
      }

      if (meme.upvotes >= 10000 && !meme.rewarded10000) {
        meme.rewarded10000 = true;
        console.log(`🏆 Meme ${memeId} reached 10,000 upvotes! Sending 100 WLO to ${meme.wallet} (${creatorTier.tier} tier)`);

        // Send 100 WLO reward
        const rewardResult = await sendWLOReward(
          meme.wallet,
          100,
          `Viral meme reward: 10000 upvotes - Meme ID: ${memeId}`
        );

        if (rewardResult.success) {
          meme.reward10000TxHash = rewardResult.txHash;
          console.log(`✅ 10,000 upvote reward sent! TX: ${rewardResult.txHash}`);
        } else {
          console.error(`❌ Failed to send 10,000 upvote reward: ${rewardResult.error}`);
        }
      }
    } else {
      console.log(`⚠️ Meme ${memeId} creator ${meme.wallet} is free tier - cannot earn WLO rewards. Upgrade to earn!`);
    }

    // Persist updated meme with new counts and any reward flags
    await redis.set(memeKey, JSON.stringify(meme));

    res.json({
      success: true,
      upvotes: upvoteCount,
      downvotes: downvoteCount
    });
  } catch (error) {
    console.error('Error in /community/vote:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/upload - Upload custom image
router.post('/upload', async (req, res) => {
  try {
    const { wallet, imageData, tier } = req.body; // imageData is base64

    if (!wallet || !imageData) {
      return res.status(400).json({ error: 'Wallet and image data required' });
    }

    // Free tier now has unlimited uploads - no restrictions!

    // Check upload limits based on tier (tracked in Redis)
    const today = new Date().toISOString().split('T')[0];
    const key = MEMEOLOGY_KEYS.usageUpload(wallet, today);
    const raw = await redis.get(key);
    const uploadCount = raw ? parseInt(raw, 10) || 0 : 0;

    let uploadLimit = 50; // WALDOCOIN tier
    if (tier === 'premium' || tier === 'king' || tier === 'platinum' || tier === 'gold') uploadLimit = 999999; // Unlimited for premium/king/platinum/gold

    if (uploadCount >= uploadLimit) {
      return res.status(429).json({
        error: `Daily upload limit reached (${uploadLimit} uploads/day). Collect 3+ NFTs for unlimited uploads!`,
        limit: uploadLimit,
        used: uploadCount
      });
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // For now we persist the base64 image data directly and rely on the
    // frontend to render it. This avoids broken placeholder URLs while still
    // being compatible with future IPFS/cloud storage integration.
    await redis.incr(key);

    console.log(`📸 Image uploaded: ${uploadId} by ${wallet.slice(0, 10)}... (${uploadCount + 1}/${uploadLimit})`);

    res.json({
      success: true,
      uploadId: uploadId,
      imageUrl: imageData,
      uploadsRemaining: uploadLimit - uploadCount - 1,
      message: 'Image uploaded successfully! Use it as a meme template.'
    });
  } catch (error) {
    console.error('Error in /upload:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/premium/subscribe - Subscribe to premium (remove watermark)
router.post('/premium/subscribe', async (req, res) => {
  try {
    const { wallet, paymentMethod, duration, txHash } = req.body; // duration: 'monthly' or 'yearly'

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash required for payment verification' });
    }

    const selectedDuration = duration || 'monthly';

    // Premium pricing: $5 USD equivalent per month
    const usdPerMonth = 5;
    const usdTotal = selectedDuration === 'yearly' ? usdPerMonth * 10 : usdPerMonth; // Yearly = 10 months (2 free)

    // Fetch real-time prices
    const prices = await getAllPrices();
    const currentXrpPrice = prices.xrp;
    const currentWloPrice = prices.wlo;

    // Calculate required amounts (used both for verification and for returning pricing info)
    const requiredXrp = await calculateTokenAmount(usdTotal, 'xrp');
    const requiredWlo = await calculateTokenAmount(usdTotal, 'wlo');

    // Verify payment on XRPL by checking txHash
    let amountPaid = 0;
    const paidCurrency = paymentMethod === 'xrp' ? 'XRP' : 'WLO';

    let client;
    try {
      client = new xrpl.Client(XRPL_SERVER);
      await client.connect();

      const txResponse = await client.request({
        command: 'tx',
        transaction: txHash
      });

      if (!txResponse.result) {
        throw new Error('Transaction not found on XRPL');
      }

      const tx = txResponse.result;

      if (!tx.validated || (tx.meta && tx.meta.TransactionResult !== 'tesSUCCESS')) {
        throw new Error('Transaction not validated or not successful');
      }

      if (tx.TransactionType !== 'Payment') {
        throw new Error('Transaction is not a Payment');
      }

      if (tx.Destination !== TREASURY_WALLET) {
        throw new Error('Payment destination does not match WALDO treasury wallet');
      }

      let amountPaidXrp = 0;
      let amountPaidWlo = 0;

      if (typeof tx.Amount === 'string') {
        // XRP amount in drops
        amountPaidXrp = Number(tx.Amount) / 1_000_000;
      } else if (typeof tx.Amount === 'object' && tx.Amount !== null) {
        if (tx.Amount.currency === WLO_CURRENCY && tx.Amount.issuer === WLO_ISSUER) {
          amountPaidWlo = parseFloat(tx.Amount.value);
        }
      }

      if (paymentMethod === 'xrp') {
        if (!amountPaidXrp) {
          throw new Error('Payment must be in XRP');
        }
        if (amountPaidXrp + 1e-6 < requiredXrp) {
          throw new Error(`Payment amount too low. Required ~${requiredXrp} XRP, received ${amountPaidXrp} XRP`);
        }
        amountPaid = amountPaidXrp;
      } else if (paymentMethod === 'wlo') {
        if (!amountPaidWlo) {
          throw new Error('Payment must be in WLO');
        }
        if (amountPaidWlo + 1e-9 < requiredWlo) {
          throw new Error(`Payment amount too low. Required ~${requiredWlo} WLO, received ${amountPaidWlo} WLO`);
        }
        amountPaid = amountPaidWlo;
      } else {
        throw new Error('Unsupported payment method');
      }

      console.log(`💳 Premium subscription payment verified: ${txHash}`);
      console.log(`💰 Duration: ${selectedDuration}, Method: ${paymentMethod}, Paid: ${amountPaid} ${paidCurrency}`);
    } catch (verificationError) {
      console.error('Error verifying premium subscription payment:', verificationError);
      return res.status(400).json({ error: `Payment verification failed: ${verificationError.message}` });
    } finally {
      if (client) {
        try {
          await client.disconnect();
        } catch (e) {
          // ignore disconnect errors
        }
      }
    }

    // Calculate expiration date
    const now = new Date();
    const expiresAt = new Date(now);
    const gracePeriodDays = 3; // 3-day grace period after expiration

    if (selectedDuration === 'monthly') {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }

    const graceExpiresAt = new Date(expiresAt);
    graceExpiresAt.setDate(graceExpiresAt.getDate() + gracePeriodDays);

    // Check if user already has a subscription
    const existingSubscription = await getPremiumSubscription(wallet);
    let isRenewal = false;

    if (existingSubscription) {
      isRenewal = true;
      console.log(`🔄 Renewing existing subscription for ${wallet}`);
    }

    // Store premium subscription in Redis
    const subscriptionRecord = {
      wallet,
      tier: 'premium',
      subscribedAt: existingSubscription?.subscribedAt || now.toISOString(),
      lastRenewalAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graceExpiresAt: graceExpiresAt.toISOString(),
      duration: selectedDuration,
      paymentMethod: paymentMethod,
      paymentTxHash: txHash,
      amountPaid: amountPaid,
      currency: paidCurrency,
      usdValue: usdTotal,
      active: true,
      autoRenew: false, // Crypto requires manual renewal
      renewalReminders: {
        threeDaysSent: false,
        oneDaySent: false,
        expirationSent: false
      }
    };

    await savePremiumSubscription(wallet, subscriptionRecord);

    console.log(`💵 Premium subscription ${isRenewal ? 'renewed' : 'created'} for ${wallet.slice(0, 10)}... (${selectedDuration})`);

    res.json({
      success: true,
      message: isRenewal
        ? `✅ Premium subscription renewed!`
        : `✅ Premium subscription activated! Watermark removed.`,
      subscription: {
        tier: 'premium',
        duration: selectedDuration,
        subscribedAt: subscriptionRecord.subscribedAt,
        expiresAt: subscriptionRecord.expiresAt,
        graceExpiresAt: subscriptionRecord.graceExpiresAt,
        gracePeriodDays: gracePeriodDays,
        daysRemaining: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)),
        autoRenew: false,
        renewalNote: 'Manual renewal required. You will receive reminders 3 days before expiration.',
        pricing: {
          usd: usdTotal,
          xrp: requiredXrp,
          wlo: requiredWlo,
          paid: amountPaid,
          currency: paidCurrency
        },
        benefits: {
          noWatermark: true,
          unlimitedMemes: true,
          unlimitedTemplates: true,
          unlimitedAI: true,
          customFonts: true,
          customUploads: true,
          gifTemplates: true,
          canEarnWLO: true
        }
      }
    });
  } catch (error) {
    console.error('Error in /premium/subscribe:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/premium/pricing - Get current premium pricing in XRP and WLO
router.get('/premium/pricing', async (req, res) => {
  try {
    const usdPerMonth = 5;
    const yearlyUsd = usdPerMonth * 10; // 2 months free

    // Fetch real-time prices from price oracle
    const prices = await getAllPrices();
    const currentXrpPrice = prices.xrp;
    const currentWloPrice = prices.wlo;

    // Calculate token amounts needed
    const monthlyXrp = await calculateTokenAmount(usdPerMonth, 'xrp');
    const monthlyWlo = await calculateTokenAmount(usdPerMonth, 'wlo');
    const yearlyXrp = await calculateTokenAmount(yearlyUsd, 'xrp');
    const yearlyWlo = await calculateTokenAmount(yearlyUsd, 'wlo');

    res.json({
      success: true,
      pricing: {
        monthly: {
          usd: usdPerMonth,
          xrp: monthlyXrp,
          wlo: monthlyWlo,
          xrpPrice: currentXrpPrice,
          wloPrice: currentWloPrice
        },
        yearly: {
          usd: yearlyUsd,
          xrp: yearlyXrp,
          wlo: yearlyWlo,
          xrpPrice: currentXrpPrice,
          wloPrice: currentWloPrice,
          savings: `$${usdPerMonth * 2} USD (2 months free)`
        }
      },
      note: 'Prices are calculated based on current market rates and may fluctuate',
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /premium/pricing:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/premium/test-activate - ADMIN: Manually activate premium for testing
router.post('/premium/test-activate', async (req, res) => {
  try {
	  const { wallet, duration } = req.body;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

	  const selectedDuration = duration || 'yearly'; // Default to yearly for testing

	  const now = new Date();
	  const expiresAt = new Date(now);
	  const gracePeriodDays = 3;

	  if (selectedDuration === 'monthly') {
	    expiresAt.setMonth(expiresAt.getMonth() + 1);
	  } else {
	    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
	  }

	  const graceExpiresAt = new Date(expiresAt);
	  graceExpiresAt.setDate(graceExpiresAt.getDate() + gracePeriodDays);

	  // Store premium subscription in Redis (test activation)
	  const subscriptionRecord = {
	    wallet,
	    tier: 'premium',
	    subscribedAt: now.toISOString(),
	    lastRenewalAt: now.toISOString(),
	    expiresAt: expiresAt.toISOString(),
	    graceExpiresAt: graceExpiresAt.toISOString(),
	    duration: selectedDuration,
	    paymentMethod: 'TEST',
	    paymentTxHash: 'TEST_ACTIVATION_' + Date.now(),
	    amountPaid: 0,
	    currency: 'TEST',
	    usdValue: 0,
	    active: true,
	    autoRenew: false,
	    renewalReminders: {
	      threeDaysSent: false,
	      oneDaySent: false,
	      expirationSent: false
	    }
	  };

	  await savePremiumSubscription(wallet, subscriptionRecord);

	  console.log(`🧪 TEST: Premium subscription activated for ${wallet.slice(0, 10)}... (${selectedDuration})`);

	  res.json({
	    success: true,
	    message: `✅ TEST: Premium subscription activated!`,
	    subscription: {
	      tier: 'premium',
	      duration: selectedDuration,
	      subscribedAt: now.toISOString(),
	      expiresAt: expiresAt.toISOString(),
	      graceExpiresAt: graceExpiresAt.toISOString(),
	      gracePeriodDays: gracePeriodDays,
	      daysRemaining: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)),
	      testMode: true
	    }
	  });
  } catch (error) {
    console.error('Error in /premium/test-activate:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/premium/status - Check premium subscription status
router.get('/premium/status/:wallet', async (req, res) => {
	  try {
	    const { wallet } = req.params;

	    const subscription = await getPremiumSubscription(wallet);

    if (!subscription) {
      return res.json({
        success: true,
        hasPremium: false,
        tier: 'free',
        message: 'No premium subscription found'
      });
    }

    // Check if subscription is expired
    const now = new Date();
    const expiresAt = new Date(subscription.expiresAt);
    const graceExpiresAt = new Date(subscription.graceExpiresAt || subscription.expiresAt);
    const isExpired = now > expiresAt;
    const isInGracePeriod = now > expiresAt && now <= graceExpiresAt;
    const isFullyExpired = now > graceExpiresAt;

    // Calculate days remaining
    const daysRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    const graceDaysRemaining = Math.ceil((graceExpiresAt - now) / (1000 * 60 * 60 * 24));

    // Determine if user needs renewal reminder
    const needsRenewalReminder = daysRemaining <= 3 && daysRemaining > 0;

	    // Update subscription status if fully expired
	    if (isFullyExpired && subscription.active) {
	      subscription.active = false;
	      await savePremiumSubscription(wallet, subscription);
	    }

    res.json({
      success: true,
      hasPremium: !isFullyExpired && subscription.active,
      tier: !isFullyExpired && subscription.active ? 'premium' : 'free',
      subscription: {
        ...subscription,
        isExpired,
        isInGracePeriod,
        isFullyExpired,
        daysRemaining,
        graceDaysRemaining: isInGracePeriod ? graceDaysRemaining : 0,
        needsRenewalReminder,
        renewalUrl: `/api/memeology/premium/subscribe`,
        status: isFullyExpired
          ? 'expired'
          : isInGracePeriod
            ? 'grace_period'
            : daysRemaining <= 3
              ? 'expiring_soon'
              : 'active'
      }
    });
  } catch (error) {
    console.error('Error in /premium/status:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/premium/cancel - Cancel premium subscription
router.post('/premium/cancel', async (req, res) => {
  try {
    const { wallet } = req.body;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

	    const subscription = await getPremiumSubscription(wallet);

    if (!subscription) {
      return res.status(404).json({ error: 'No active premium subscription found' });
    }

	    // Mark as cancelled (will expire at end of paid period)
	    subscription.active = false;
	    subscription.cancelledAt = new Date().toISOString();
	    await savePremiumSubscription(wallet, subscription);

    console.log(`❌ Premium subscription cancelled for ${wallet.slice(0, 10)}...`);

    res.json({
      success: true,
      message: 'Premium subscription cancelled. Access will continue until expiration date.',
      expiresAt: subscription.expiresAt
    });
  } catch (error) {
    console.error('Error in /premium/cancel:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/ai/suggest - Get AI meme text suggestion
router.post('/ai/suggest', async (req, res) => {
  try {
    const { wallet, templateName, position, tier } = req.body;

    // Allow anonymous users for free tier
    const userKey = wallet || 'anonymous';

    // Check tier limits
    const limits = {
      free: 1,
      waldocoin: 10,
      premium: 999999,
      gold: 999999,
      platinum: 999999,
      king: 999999
    };

    const dailyLimit = limits[tier] || 1;

	  // Track daily usage in Redis so limits survive restarts and scale
	  const today = new Date().toISOString().split('T')[0];
	  const usageKey = MEMEOLOGY_KEYS.usageAi(userKey, today);
	  const rawUsage = await redis.get(usageKey);
	  const usageCount = rawUsage ? parseInt(rawUsage, 10) || 0 : 0;

    if (usageCount >= dailyLimit) {
      return res.status(429).json({
        error: `Daily AI suggestion limit reached (${dailyLimit}/day)`,
        message: tier === 'free'
          ? 'Upgrade to WALDOCOIN (1000+ WLO) for 10 suggestions/day or PREMIUM for unlimited!'
          : 'Daily limit reached. Try again tomorrow!',
        limit: dailyLimit,
        used: usageCount
      });
    }

    // Generate AI suggestion using Groq (free and fast)
    let suggestion = '';

    if (GROQ_API_KEY) {
      try {
        const prompt = `Generate a funny, short meme text for the "${templateName}" meme template.
Position: ${position}.
Make it witty, relatable, and under 50 characters.
Only respond with the meme text, nothing else.`;

        const groqResponse = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: 'You are a witty meme text generator. Generate short, funny meme captions.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 50,
            temperature: 0.9
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        suggestion = groqResponse.data.choices[0].message.content.trim();
      } catch (aiError) {
        console.error('Groq AI error:', aiError.response?.data || aiError.message);
        // Fallback to template-based suggestions
        suggestion = getFallbackSuggestion(templateName, position);
      }
    } else {
      // No API key - use fallback
      suggestion = getFallbackSuggestion(templateName, position);
    }

	  // Increment usage count for today
	  await redis.incr(usageKey);

    res.json({
      success: true,
      suggestion: suggestion,
      remaining: dailyLimit - usageCount - 1
    });
  } catch (error) {
    console.error('Error in /ai/suggest:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fallback suggestions when AI is not available
function getFallbackSuggestion(templateName, position) {
  const suggestions = {
    top: [
      "When you realize...",
      "Nobody:",
      "Me trying to...",
      "POV:",
      "That moment when...",
      "Everyone else:",
      "My brain at 3am:"
    ],
    bottom: [
      "It be like that sometimes",
      "Why am I like this",
      "Task failed successfully",
      "Understandable, have a nice day",
      "I'm in danger",
      "This is fine",
      "Suffering from success"
    ],
    middle: [
      "Meanwhile...",
      "Plot twist:",
      "Narrator: It wasn't",
      "Surprise!",
      "Awkward...",
      "Oops",
      "Big brain time"
    ]
  };

  const positionSuggestions = suggestions[position] || suggestions.top;
  return positionSuggestions[Math.floor(Math.random() * positionSuggestions.length)];
}

// GET /api/memeology/gifs/search - Search for GIF templates
router.get('/gifs/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    if (!GIPHY_API_KEY || GIPHY_API_KEY === 'YOUR_GIPHY_API_KEY') {
      return res.status(503).json({
        error: 'GIF search is not configured',
        message: 'Please add GIPHY_API_KEY to environment variables'
      });
    }

    // Search Giphy API
    const response = await axios.get('https://api.giphy.com/v1/gifs/search', {
      params: {
        api_key: GIPHY_API_KEY,
        q: q,
        limit: 20,
        rating: 'pg-13'
      }
    });

    const gifs = response.data.data.map(gif => ({
      id: gif.id,
      title: gif.title,
      url: gif.images.fixed_height.url,
      width: gif.images.fixed_height.width,
      height: gif.images.fixed_height.height
    }));

    res.json({
      success: true,
      gifs: gifs,
      count: gifs.length
    });
  } catch (error) {
    console.error('Error in /gifs/search:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/ai/generate - AI generates complete meme from description
router.post('/ai/generate', async (req, res) => {
  try {
	    const { prompt, wallet, tier, mode, templateId: requestedTemplateId } = req.body; // mode: 'template' or 'ai-image'

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

	    // Allow anonymous users for free tier
	    const userKey = wallet || 'anonymous';

	    // Decide generation mode: 'template' (fast) or 'ai-image' (custom)
	    const generationMode = mode || 'template';

	    // Normalize user tier (used for both modes)
	    const userTier = tier || 'free';

	    if (generationMode === 'ai-image') {
		      // MODE 1: AI-GENERATED IMAGE
		      // - Prompts the AI to avoid any text in the picture
		      // - For FREE tier, we add a small logo watermark image (no words)
		      // - For WALDOCOIN / PREMIUM / NFT tiers, we return a completely clean image
		      try {
		        // Generate meme image using AI - explicitly avoid any text in the picture
		        const memePrompt = `${prompt}, funny meme style, internet meme aesthetic, high quality, no text, no words, no letters, clean image`;
		        const encodedPrompt = encodeURIComponent(memePrompt);
		
		        // Generate AI image URL with provider logo disabled
		        const aiImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=600&nologo=true&seed=${Date.now()}`;
		
		        console.log('🎨 Generating AI image:', aiImageUrl, 'tier=', userTier);
		
		        // Download the AI-generated image
		        const imageResponse = await axios.get(aiImageUrl, {
		          responseType: 'arraybuffer',
		          timeout: 30000 // 30 second timeout
		        });
		
		        const imageBuffer = Buffer.from(imageResponse.data);
		
		        let finalBuffer = imageBuffer;
		
		        // For FREE tier only, add a small logo image watermark (no text)
		        if (userTier === 'free' && sharp) {
		          try {
		            const watermarkPath = path.join(__dirname, '../public/memeology-logo.png');
		            const image = sharp(imageBuffer);
		            const metadata = await image.metadata();
		
		            // Logo size: ~15% of image width
		            const watermarkSize = Math.floor((metadata.width || 800) * 0.15);
		            const watermark = await sharp(watermarkPath)
		              .resize(watermarkSize, watermarkSize)
		              .png()
		              .toBuffer();
		
		            const padding = 15;
		
		            finalBuffer = await image
		              .composite([
		                {
		                  input: watermark,
		                  left: (metadata.width || 800) - watermarkSize - padding,
		                  top: (metadata.height || 600) - watermarkSize - padding
		                }
		              ])
		              .jpeg({ quality: 90 })
		              .toBuffer();
		
		            console.log('✅ AI image logo watermark applied for FREE tier');
		          } catch (wmError) {
		            console.warn('⚠️  Failed to apply AI image watermark, returning raw image:', wmError.message);
		            finalBuffer = imageBuffer; // Fallback to original
		          }
		        }
		
		        // Convert to base64 for sending to frontend
		        const base64Image = `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
		
		        return res.json({
		          success: true,
		          meme_url: base64Image,
		          template_name: 'AI Generated Image',
		          mode: 'ai-image',
		          tier: userTier,
		          message: userTier === 'free'
		            ? 'AI image generated with logo watermark for free tier'
		            : 'AI image generated with no watermark'
		        });
		      } catch (error) {
		        console.error('AI image generation error:', error.message);
		        // Fallback to template mode
		      }
	    }

		    // MODE 2: TEMPLATE-BASED MEME (default)
		
		    // Get templates based on user's tier (380 total templates from 7 sources)
		    const userTemplates = getTemplatesForTier(userTier);
		    console.log(`📚 User tier "${userTier}" has access to ${userTemplates.length} templates`);
		
		    // If the frontend requested a specific template (old Browse flow),
		    // try to honor that. Otherwise, try to infer a good template from
		    // the user's prompt (e.g. "Drake", "UNO", "distracted boyfriend").
		    // If nothing matches, fall back to a random high-quality template.
		    let selectedTemplate = null;
		    if (requestedTemplateId) {
		      selectedTemplate = getTemplateById(requestedTemplateId, userTier);
		      if (!selectedTemplate) {
		        console.warn(`⚠️  Requested templateId "${requestedTemplateId}" not available for tier "${userTier}" – falling back to prompt-based match`);
		      } else {
		        console.log(`🎯 Using requested template: ${selectedTemplate.name} (id: ${requestedTemplateId})`);
		      }
		    }
		
		    // Try to pick a template that matches what the user typed
		    if (!selectedTemplate) {
		      try {
		        const searchResults = searchTemplates(prompt, userTier, null);
		        if (Array.isArray(searchResults) && searchResults.length > 0) {
		          selectedTemplate = searchResults[0];
		          console.log(`🎯 Using prompt-matched template: ${selectedTemplate.name}`);
		        }
		      } catch (searchError) {
		        console.warn('Template search failed, falling back to random template:', searchError.message);
		      }
		    }
		
		    if (!selectedTemplate) {
		      // Randomly select a template from user's available templates
		      selectedTemplate = getRandomTemplate(userTier);
		      console.log('🎲 Using random template as fallback');
		    }

	    if (!selectedTemplate) {
	      return res.status(500).json({ error: 'No templates available for your tier' });
	    }

	    console.log(`🎲 Selected template: ${selectedTemplate.name} (${selectedTemplate.source}) - Rank: ${selectedTemplate.rank}, Score: ${selectedTemplate.qualityScore}`);

	    // Convert template to Imgflip format if needed
	    const imgflipTemplate = toImgflipFormat(selectedTemplate);
	    let templateId = imgflipTemplate.id;
	    let templateName = selectedTemplate.name;
	    let templateType = selectedTemplate.type || selectedTemplate.id;
    let topText = '';
    let bottomText = '';

    if (GROQ_API_KEY) {
      try {
        // Add timestamp to make each request unique and prevent caching
        const timestamp = Date.now();
        const randomSeed = Math.floor(Math.random() * 1000000);

        const groqResponse = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.1-8b-instant',
            messages: [
              {
                role: 'system',
                content: `You are an EXPERT meme creator who understands internet humor, viral trends, and what makes people laugh.

MEME TEMPLATE: ${templateName}

YOUR MISSION:
Create hilarious, relatable meme text that will make people share it. Study the template format and use it correctly.

GOLDEN RULES:
1. Be PUNCHY - Short, impactful text (3-8 words per line max)
2. Be RELATABLE - Universal experiences everyone gets
3. Be UNEXPECTED - Twist endings, subvert expectations
4. Use INTERNET SLANG - "POV:", "Nobody:", "Me:", etc. when appropriate
5. NEVER repeat the user's exact words - transform them into meme format
6. Match the template style (comparison, reaction, escalation, etc.)

MEME FORMATS TO USE:
- Setup/Punchline (most templates)
- "Nobody: / Me:" (for unprompted actions)
- "POV:" (point of view scenarios)
- Escalation (brain meme, gru's plan)
- Comparison (drake, buttons, exit ramp)

UNIQUENESS SEED: ${randomSeed}
REQUEST ID: ${timestamp}

RESPOND ONLY WITH JSON:
{"top_text": "setup or context", "bottom_text": "punchline or reaction"}

EXAMPLES:
User: "being tired"
Good: {"top_text": "COFFEE", "bottom_text": "MORE COFFEE"}
Bad: {"top_text": "WHEN YOU ARE TIRED", "bottom_text": "YOU FEEL TIRED"}

User: "monday morning"
Good: {"top_text": "ALARM CLOCK", "bottom_text": "SNOOZE BUTTON GO BRRR"}
Bad: {"top_text": "IT IS MONDAY MORNING", "bottom_text": "I DO NOT LIKE IT"}`
              },
              {
                role: 'user',
                content: `Create a VIRAL-WORTHY meme about: "${prompt}"

Make it funny, relatable, and shareable. Use the ${templateName} format effectively.`
              }
            ],
            max_tokens: 100,
            temperature: 1.0,
            top_p: 0.95,
            response_format: { type: "json_object" }
          },
          {
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const aiResponse = groqResponse.data.choices[0].message.content.trim();
        console.log('AI raw response:', aiResponse);

        // Try to parse JSON response
        try {
          // Remove markdown code blocks if present
          let jsonStr = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(jsonStr);

          topText = parsed.top_text || parsed.top || '';
          bottomText = parsed.bottom_text || parsed.bottom || '';

          console.log('Parsed AI response:', { templateId, templateName, topText, bottomText });
        } catch (parseError) {
          // If AI didn't return valid JSON, extract text manually
          console.log('AI response not valid JSON:', aiResponse, parseError.message);
          topText = 'WHEN YOU';
          bottomText = prompt.toUpperCase().substring(0, 40);
        }
      } catch (error) {
        console.error('❌ Groq API error:', error.response?.data || error.message);
        console.error('Full error:', error);

        // Creative fallback - make it a proper meme format
        const fallbacks = [
          { top: 'WHEN YOU', bottom: prompt.toUpperCase().substring(0, 40) },
          { top: 'ME WHEN', bottom: prompt.toUpperCase().substring(0, 40) },
          { top: 'NOBODY:', bottom: 'ME: ' + prompt.toUpperCase().substring(0, 35) }
        ];

        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        topText = randomFallback.top;
        bottomText = randomFallback.bottom;

        console.log('Using error fallback text:', { topText, bottomText });
      }
    } else {
      // No API key - use creative fallback based on template
      console.log('⚠️  No GROQ_API_KEY - using creative fallback');

      // Create more varied fallback text based on template
      const fallbacks = [
        { top: 'WHEN YOU', bottom: prompt.toUpperCase().substring(0, 40) },
        { top: 'ME WHEN', bottom: prompt.toUpperCase().substring(0, 40) },
        { top: 'NOBODY:', bottom: 'ME: ' + prompt.toUpperCase().substring(0, 35) },
        { top: prompt.toUpperCase().substring(0, 40), bottom: 'EVERY TIME' },
        { top: 'POV:', bottom: prompt.toUpperCase().substring(0, 40) }
      ];

      const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      topText = randomFallback.top;
      bottomText = randomFallback.bottom;

      console.log('Using fallback text:', { topText, bottomText });
    }

    // Step 2: Generate the meme using Imgflip API
    console.log('Generating meme with:', { templateId, topText, bottomText });

    // Try with credentials first, fallback to URL-based generation if credentials fail
    let memeUrl = null;

    try {
      const imgflipResponse = await axios.post(
        'https://api.imgflip.com/caption_image',
        new URLSearchParams({
          template_id: templateId,
          username: IMGFLIP_USERNAME,
          password: IMGFLIP_PASSWORD,
          text0: topText,
          text1: bottomText
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      console.log('Imgflip response:', imgflipResponse.data);

      if (imgflipResponse.data.success) {
        memeUrl = imgflipResponse.data.data.url;
      } else if (imgflipResponse.data.error_message && imgflipResponse.data.error_message.includes('Invalid username')) {
        // Credentials invalid - use fallback method
        console.log('Imgflip credentials invalid, using fallback URL method');
        throw new Error('Invalid credentials');
      }
    } catch (imgflipError) {
      // Fallback: Generate meme URL manually (works without authentication)
      console.log('Using fallback meme generation method');
      const encodedTop = encodeURIComponent(topText);
      const encodedBottom = encodeURIComponent(bottomText);

	      // IMPORTANT:
	      // Imgflip credentials often fail in production. To avoid always
	      // defaulting to the Drake template, we try to use Memegen's
	      // `custom` template with the actual background image URL when
	      // we have one. This keeps variety across all templates.
	      let memgenTemplate = null;
	      let useCustomBackground = false;
	      let backgroundUrl = null;

	      // If we have a concrete template image URL, use Memegen's custom mode
	    	      if (selectedTemplate && selectedTemplate.url) {
	    	        useCustomBackground = true;
	    	        backgroundUrl = selectedTemplate.url;
	      } else if (templateType && templateType.startsWith('imgflip_')) {
	        // Extract the numeric Imgflip ID from values like 'imgflip_100777631'
	        const imgflipId = templateType.replace('imgflip_', '');
	        memgenTemplate = getMemgenTemplate(imgflipId);
	      } else if (selectedTemplate && selectedTemplate.source === 'imgflip' && imgflipTemplate && imgflipTemplate.id) {
	        // Fallback: use the Imgflip ID from the converted template
	        memgenTemplate = getMemgenTemplate(imgflipTemplate.id);
	      } else {
	        // For non-Imgflip templates, `templateType` may already be a valid
	        // memegen slug (e.g. 'drake', 'cmm'); fall back to the helper map.
	        memgenTemplate = templateType || getMemgenTemplate(templateId);
	      }

	      if (useCustomBackground && backgroundUrl) {
	        memeUrl = `https://api.memegen.link/images/custom/${encodedTop}/${encodedBottom}.jpg?background=${encodeURIComponent(backgroundUrl)}`;
	      } else {
	        // Final safety: if we still don't have a valid slug, default to Drake
	        if (!memgenTemplate) {
	          memgenTemplate = 'drake';
	        }
	        memeUrl = `https://api.memegen.link/images/${memgenTemplate}/${encodedTop}/${encodedBottom}.jpg`;
	      }

	    	      console.log('🖼️ Generated memegen URL (fallback):', memeUrl, {
	        useCustomBackground,
	        backgroundUrl,
	        memgenTemplate,
	        templateId,
	        templateType
	      });
    }

    if (memeUrl) {
      // Download the template meme and add watermark (if sharp is available)
      try {
        console.log('📥 Downloading template meme from:', memeUrl);
        const memeResponse = await axios.get(memeUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const memeBuffer = Buffer.from(memeResponse.data);

        // If sharp is not available, return image without watermark
        if (!sharp) {
          console.log('⚠️  Returning template meme without watermark (sharp not available)');
          const base64Image = `data:image/jpeg;base64,${memeBuffer.toString('base64')}`;
          return res.json({
            success: true,
            meme_url: base64Image,
            template_name: templateName,
            texts: { top: topText, bottom: bottomText },
            mode: 'template'
          });
        }

        // Load watermark logo
        const watermarkPath = path.join(__dirname, '../public/memeology-logo.png');

        // Process with Sharp to add watermark
        const image = sharp(memeBuffer);
        const metadata = await image.metadata();

        // Calculate watermark size (15% of image width)
        const watermarkSize = Math.floor(metadata.width * 0.15);

        // Resize watermark
        const watermark = await sharp(watermarkPath)
          .resize(watermarkSize, watermarkSize)
          .png()
          .toBuffer();

        // Add watermark on BOTTOM-LEFT
        const padding = 15;
        const watermarkedImage = await image
          .composite([{
            input: watermark,
            left: padding,
            top: metadata.height - watermarkSize - padding
          }])
          .jpeg({ quality: 90 })
          .toBuffer();

        // Convert to base64
        const base64Image = `data:image/jpeg;base64,${watermarkedImage.toString('base64')}`;

        console.log('✅ Template meme with watermark created');

        // 📊 TRACK ANALYTICS
        const startTime = Date.now();
        trackMemeGeneration({
          userId: wallet || req.sessionID,
          sessionId: req.sessionID,
          tier: tier || 'free',
	    	      templateId: selectedTemplate.id,
	    	      templateName: selectedTemplate.name,
	    	      templateSource: selectedTemplate.source,
	    	      templateCategory: selectedTemplate.categories,
	    	      templateQualityScore: selectedTemplate.qualityScore,
	    	      templateRank: selectedTemplate.rank,
          generationMode: mode || 'template',
          userPrompt: prompt,
          aiModel: 'groq-llama-3.1-8b',
          aiGeneratedText: `${topText} / ${bottomText}`,
          generationTimeMs: Date.now() - startTime,
          deviceType: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'desktop',
          browser: req.headers['user-agent']?.split(' ')[0]
        }).catch(err => console.error('Analytics error:', err));

        res.json({
          success: true,
          meme_url: base64Image,
          template_name: templateName,
          texts: { top: topText, bottom: bottomText },
          mode: 'template'
        });
      } catch (watermarkError) {
        console.error('Failed to add watermark to template, returning proxied URL:', watermarkError.message);
        // Fallback: proxy the URL so frontend can access it without CORS issues
        const proxyBase = `${req.protocol}://${req.get('host')}/api/memeology/templates/proxy?url=`;
        const proxiedMemeUrl = `${proxyBase}${encodeURIComponent(memeUrl)}`;
        res.json({
          success: true,
          meme_url: proxiedMemeUrl,
          template_name: templateName,
          texts: { top: topText, bottom: bottomText },
          mode: 'template'
        });
      }
    } else {
      console.error('Failed to generate meme');
      res.status(500).json({
        success: false,
        error: 'Failed to generate meme image'
      });
    }
  } catch (error) {
    console.error('Error in /ai/generate:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error_message || error.message || 'Failed to generate meme'
    });
  }
});

// GET /api/memeology/templates/search - Search templates by name, category, or keywords
router.get('/templates/search', async (req, res) => {
  try {
    const { q, tier, category, limit = 50 } = req.query;
    const userTier = tier || 'free';

    // Search templates
    const results = searchTemplates(q, userTier, category);

    // Limit results
    const limitedResults = results.slice(0, parseInt(limit));

    console.log(`🔍 Template search: query="${q}", tier="${userTier}", category="${category || 'all'}", found=${results.length}`);

    res.json({
      success: true,
      templates: limitedResults,
      total: results.length,
      showing: limitedResults.length,
      tier: userTier,
      query: q || '',
      category: category || 'all'
    });
  } catch (error) {
    console.error('Error in /templates/search:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/categories - Get all template categories
router.get('/templates/categories', async (req, res) => {
  try {
    const categories = getCategories();

    res.json({
      success: true,
      categories: categories,
      total: categories.length
    });
  } catch (error) {
    console.error('Error in /templates/categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/stats - Get template library statistics
router.get('/templates/stats', async (req, res) => {
  try {
    const stats = getTierStats();

    res.json({
      success: true,
      stats: stats,
      tiers: {
        free: {
          templates: stats.free,
          description: 'Top 50 highest quality templates'
        },
        waldocoin: {
          templates: stats.free + stats.waldocoin,
          description: 'Top 150 templates (requires 1000+ WLO)'
        },
        premium: {
          templates: stats.total,
          description: 'All 380 templates from 7 sources'
        }
      }
    });
  } catch (error) {
    console.error('Error in /templates/stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/random - Get a random template for user's tier
router.get('/templates/random', async (req, res) => {
  try {
    const { tier, category } = req.query;
    const userTier = tier || 'free';

    const template = getRandomTemplate(userTier, category);

    if (!template) {
      return res.status(404).json({
        error: 'No templates found',
        tier: userTier,
        category: category || 'all'
      });
    }

    res.json({
      success: true,
      template: template,
      tier: userTier
    });
  } catch (error) {
    console.error('Error in /templates/random:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/:id - Get specific template by ID
router.get('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tier } = req.query;
    const userTier = tier || 'free';

    const template = getTemplateById(id, userTier);

    if (!template) {
      return res.status(404).json({
        error: 'Template not found or not accessible for your tier',
        id: id,
        tier: userTier
      });
    }

    res.json({
      success: true,
      template: template,
      tier: userTier
    });
  } catch (error) {
    console.error('Error in /templates/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

