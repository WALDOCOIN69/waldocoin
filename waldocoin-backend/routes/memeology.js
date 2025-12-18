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
import { validateAdminKey, getAdminKey } from '../utils/adminAuth.js';

dotenv.config();

// Try to import cloudinary, but make it optional
let cloudinary = null;
try {
  const cloudinaryModule = await import('cloudinary');
  cloudinary = cloudinaryModule.v2;
  console.log('✅ Cloudinary loaded successfully');
} catch (error) {
  console.warn('⚠️  Cloudinary not available - custom template uploads disabled:', error.message);
}

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
// Distribution wallet for premium subscription payments (can be overridden by env)
const TREASURY_WALLET = process.env.TREASURY_WALLET || 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';

// 510 Redis-backed key helpers for Memeology
const MEMEOLOGY_KEYS = {
  premiumSubscription: (wallet) => `memeology:premium:${wallet}`,
  usageMeme: (wallet, date) => `memeology:usage:meme:${wallet}:${date}`,
  usageUpload: (wallet, date) => `memeology:usage:upload:${wallet}:${date}`,
  usageAi: (userKey, date) => `memeology:usage:ai:${userKey}:${date}`,
  communityList: 'memeology:community:memes',
  meme: (id) => `memeology:meme:${id}`,
  memeUpvotes: (id) => `memeology:meme:${id}:upvotes`,
  memeDownvotes: (id) => `memeology:meme:${id}:downvotes`,
  customTemplates: 'memeology:custom:templates',
  customTemplate: (id) => `memeology:custom:template:${id}`,
  // Template submission system
  pendingTemplates: 'memeology:templates:pending',
  pendingTemplate: (id) => `memeology:template:pending:${id}`,
  approvedCreatorTemplates: 'memeology:templates:creator',
  creatorTemplate: (id) => `memeology:template:creator:${id}`,
  templateUsage: (id) => `memeology:template:usage:${id}`,
  creatorEarnings: (wallet) => `memeology:creator:earnings:${wallet}`,
  creatorSubmissions: (wallet, month) => `memeology:creator:submissions:${wallet}:${month}`
};

// Creator template payout amount (100 WLO per use)
const CREATOR_PAYOUT_PER_USE = 100;

// Configure Cloudinary for image uploads (if available)
if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('✅ Cloudinary configured for custom template uploads');
} else if (!cloudinary) {
  console.warn('⚠️  Cloudinary module not available - custom template uploads disabled');
} else {
  console.warn('⚠️  Cloudinary env vars missing - custom template uploads disabled');
}

// Admin authentication middleware for memeology
const requireMemeologyAdmin = (req, res, next) => {
  const adminKey = getAdminKey(req);
  const validation = validateAdminKey(adminKey);
  if (!validation.valid) {
    return res.status(403).json({ success: false, error: validation.error });
  }
  next();
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
        useNftImages: true,
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
        useNftImages: true,
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
        useNftImages: true,
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
        useNftImages: true,
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '💵 PREMIUM'
      };
    }
    // 🪙 WALDOCOIN TIER (1000+ WLO) - CAN EARN WLO - HAS WATERMARK
    else if (tier === 'waldocoin') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: '0.1 WLO',
        aiSuggestions: '10/day',
        customFonts: true,
        noWatermark: false,  // WALDOCOIN tier has watermark
        nftArtIntegration: true,
        useNftImages: true,
        gifTemplates: 'unlimited',
        communityGallery: true,
        canEarnWLO: true,
        badge: '🪙 WALDOCOIN'
      };
    }
    // 🆓 FREE TIER - FULL TEMPLATE ACCESS, AI LIMITS ONLY, NO GIFS, NO NFT IMAGES
    else {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: '1/day',
        customFonts: true,
        noWatermark: false,  // FREE tier has watermark
        nftArtIntegration: false,
        useNftImages: false,
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

// GET /api/memeology/templates/imgflip - Get meme templates (from ranked templates file)
// NOTE: Despite the name, this now serves from our curated templates-ranked.json (380+ templates)
// instead of live Imgflip API (which only returns 100)
router.get('/templates/imgflip', async (req, res) => {
  try {
    const { tier } = req.query;
    const userTier = tier || 'free';

    // Get templates from our ranked templates file (380+ templates from multiple sources)
    const allMemes = getTemplatesForTier('king'); // Get ALL templates first, then filter
    const totalCount = allMemes.length;

    // Filter templates based on tier
    let templates;
    let upgradeMessage = '';
    let features = {};

    // FREE tier only gets the top 100 imgflip templates
    if (userTier === 'free') {
      templates = allMemes.slice(0, 100);
    } else {
      // All paid tiers get all templates
      templates = allMemes;
    }

    // 👑 KING, 💎 PLATINUM (10+ NFTs), 🥇 GOLD (3-9 NFTs) - UNLIMITED FREE ACCESS
    if (userTier === 'king' || userTier === 'platinum' || userTier === 'gold') {
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
        use_nft_images: true,
        gif_templates: 'unlimited',
        can_earn_wlo: true
      };
    }
    // 💵 PREMIUM SUBSCRIPTION ($5/month)
    else if (userTier === 'premium') {
      upgradeMessage = '💵 PREMIUM SUBSCRIBER: Unlimited everything! Collect 3+ NFTs for free unlimited access!';
      features = {
        templates: 'unlimited',
        memes_per_day: 'unlimited',
        fee_per_meme: 'none',
        ai_suggestions: 'unlimited',
        custom_fonts: true,
        no_watermark: true,
        nft_art_integration: true,
        use_nft_images: true,
        gif_templates: 'unlimited',
        can_earn_wlo: true
      };
    }
    // 🪙 WALDOCOIN TIER (1000+ WLO) - ALL TEMPLATES + UNLIMITED AI, NO GIFS/NFTS
    else if (userTier === 'waldocoin') {
      upgradeMessage = '🪙 WALDOCOIN Tier: All 380+ templates, unlimited AI! Upgrade to Premium for GIFs & NFT images!';
      features = {
        templates: 'all (380+)',
        memes_per_day: 'unlimited',
        fee_per_meme: '0.1 WLO',
        ai_suggestions: 'unlimited',
        custom_fonts: true,
        no_watermark: false,
        nft_art_integration: false,
        use_nft_images: false,
        gif_templates: 'none',
        can_earn_wlo: true
      };
    }
    // 🆓 FREE TIER - 100 TEMPLATES ONLY, 10 AI/MONTH, NO GIFS, NO NFT IMAGES
    else {
      upgradeMessage = '🆓 Free Tier: 100 templates, 10 AI/month. Hold 1000+ WLO for all templates & unlimited AI!';
      features = {
        templates: '100',
        memes_per_day: 'unlimited',
        fee_per_meme: 'none',
        ai_suggestions: '10/month',
        custom_fonts: true,
        no_watermark: false,
        nft_art_integration: false,
        use_nft_images: false,
        gif_templates: 'none',
        can_earn_wlo: false
      };
    }

    console.log(`📋 Templates endpoint: tier=${userTier}, returning ${templates.length}/${totalCount} templates`);

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

// POST /api/memeology/upload - Upload custom image (ADMIN ONLY)
// Users can only use templates or their own NFT images - no arbitrary uploads
router.post('/upload', requireMemeologyAdmin, async (req, res) => {
  try {
    const { imageData, name } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'Image data required' });
    }

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`📸 Admin image uploaded: ${uploadId} - ${name || 'unnamed'}`);

    res.json({
      success: true,
      uploadId: uploadId,
      imageUrl: imageData,
      message: 'Image uploaded successfully (admin).'
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

    // Premium pricing: $5/month or $50/year lump sum
    const monthlyUsd = 5;
    const yearlyUsd = 50;
    const usdTotal = selectedDuration === 'yearly' ? yearlyUsd : monthlyUsd;

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
    const monthlyUsd = 5;  // $5/month
    const yearlyUsd = 50;  // $50/year lump sum

    // Fetch prices (cached for 24 hours)
    const prices = await getAllPrices();
    const currentXrpPrice = prices.xrp;
    const currentWloPrice = prices.wlo;

    // Calculate token amounts needed
    const monthlyXrp = await calculateTokenAmount(monthlyUsd, 'xrp');
    const monthlyWlo = await calculateTokenAmount(monthlyUsd, 'wlo');
    const yearlyXrp = await calculateTokenAmount(yearlyUsd, 'xrp');
    const yearlyWlo = await calculateTokenAmount(yearlyUsd, 'wlo');

    res.json({
      success: true,
      pricing: {
        monthly: {
          usd: monthlyUsd,
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
          savings: '$10 USD (2 months free)'
        }
      },
      note: 'Prices updated once per day based on market rates',
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

    // Free tier: 10/month, WALDOCOIN+: unlimited
    if (tier === 'free') {
      // Track monthly usage for free tier
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const usageKey = `memeology:usage:ai:monthly:${userKey}:${currentMonth}`;
      const rawUsage = await redis.get(usageKey);
      const usageCount = rawUsage ? parseInt(rawUsage, 10) || 0 : 0;

      if (usageCount >= 10) {
        return res.status(429).json({
          error: 'Monthly AI suggestion limit reached (10/month)',
          message: 'Hold 1000+ WLO for unlimited AI suggestions!',
          limit: 10,
          used: usageCount
        });
      }

      // Increment monthly counter
      await redis.set(usageKey, usageCount + 1);
      // Set expiry to end of month + 1 day buffer (max 32 days)
      await redis.expire(usageKey, 32 * 24 * 60 * 60);
    }
    // WALDOCOIN and above: unlimited, but still track for analytics
    else {
      const today = new Date().toISOString().split('T')[0];
      const usageKey = MEMEOLOGY_KEYS.usageAi(userKey, today);
      const rawUsage = await redis.get(usageKey);
      const usageCount = rawUsage ? parseInt(rawUsage, 10) || 0 : 0;
      await redis.set(usageKey, usageCount + 1);
      await redis.expire(usageKey, 2 * 24 * 60 * 60); // 2 days TTL
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

    res.json({
      success: true,
      suggestion: suggestion
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
          templates: stats.total,
          description: 'All templates (unlimited)'
        },
        waldocoin: {
          templates: stats.total,
          description: 'All templates + can earn WLO (requires 1000+ WLO)'
        },
        premium: {
          templates: stats.total,
          description: 'All templates + no watermark + no fees'
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

// =====================================================
// ADMIN ENDPOINTS - Custom Template Management
// =====================================================

// POST /api/memeology/admin/templates/upload - Upload a custom template image
// Admin can optionally specify a creatorWallet to credit a user for template usage payouts
router.post('/admin/templates/upload', requireMemeologyAdmin, async (req, res) => {
  try {
    const { imageData, name, boxCount, tier, categories, creatorWallet } = req.body;

    if (!imageData || !name) {
      return res.status(400).json({ success: false, error: 'Image data and name are required' });
    }

    // Check Cloudinary is available and configured
    if (!cloudinary) {
      return res.status(500).json({ success: false, error: 'Cloudinary module not available' });
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({ success: false, error: 'Cloudinary not configured' });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(imageData, {
      folder: 'memeology-templates',
      resource_type: 'image',
      public_id: `template_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    });

    // Create template object
    const templateId = `custom_${Date.now()}`;
    const categoriesArray = categories ? (Array.isArray(categories) ? categories : [categories]) : ['custom'];
    const template = {
      id: templateId,
      name: name.trim(),
      url: uploadResult.secure_url,
      cloudinaryId: uploadResult.public_id,
      box_count: String(parseInt(boxCount) || 2),
      tier: tier || 'free',
      categories: JSON.stringify(categoriesArray),
      source: 'custom',
      createdAt: new Date().toISOString(),
      width: String(uploadResult.width),
      height: String(uploadResult.height),
      // Optional: credit a user's wallet for template usage payouts (100 WLO per use)
      creatorWallet: creatorWallet || '',
      isCreatorTemplate: creatorWallet ? 'true' : 'false',
      uses: '0'
    };

    // Save to Redis - all values must be strings
    await redis.hSet(MEMEOLOGY_KEYS.customTemplate(templateId), template);
    await redis.lPush(MEMEOLOGY_KEYS.customTemplates, templateId);

    // If this is a creator template, also add to creator templates list for tracking
    if (creatorWallet) {
      await redis.hSet(MEMEOLOGY_KEYS.creatorTemplate(templateId), template);
      await redis.lPush(MEMEOLOGY_KEYS.approvedCreatorTemplates, templateId);
      console.log(`🎨 Custom template uploaded with creator payout: ${name} (${templateId}) -> ${creatorWallet}`);
    } else {
      console.log(`🎨 Custom template uploaded: ${name} (${templateId})`);
    }

    res.json({
      success: true,
      message: 'Template uploaded successfully',
      template
    });

  } catch (error) {
    console.error('Error uploading custom template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/memeology/admin/templates - Get all custom templates
router.get('/admin/templates', requireMemeologyAdmin, async (req, res) => {
  try {
    const templateIds = await redis.lRange(MEMEOLOGY_KEYS.customTemplates, 0, -1);
    const templates = [];

    for (const id of templateIds) {
      const template = await redis.hGetAll(MEMEOLOGY_KEYS.customTemplate(id));
      if (template && Object.keys(template).length > 0) {
        // Parse categories if stored as string
        if (typeof template.categories === 'string') {
          try {
            template.categories = JSON.parse(template.categories);
          } catch (e) {
            template.categories = [template.categories];
          }
        }
        templates.push(template);
      }
    }

    res.json({
      success: true,
      templates,
      count: templates.length
    });

  } catch (error) {
    console.error('Error getting custom templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/memeology/admin/templates/:id - Delete a custom template
router.delete('/admin/templates/:id', requireMemeologyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get template to find Cloudinary ID
    const template = await redis.hGetAll(MEMEOLOGY_KEYS.customTemplate(id));
    if (!template || Object.keys(template).length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Delete from Cloudinary if available
    if (template.cloudinaryId && cloudinary) {
      try {
        await cloudinary.uploader.destroy(template.cloudinaryId);
      } catch (cloudErr) {
        console.warn('Could not delete from Cloudinary:', cloudErr.message);
      }
    }

    // Delete from Redis
    await redis.del(MEMEOLOGY_KEYS.customTemplate(id));
    await redis.lRem(MEMEOLOGY_KEYS.customTemplates, 0, id);

    console.log(`🗑️ Custom template deleted: ${template.name} (${id})`);

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting custom template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/memeology/admin/templates/:id - Update a custom template
router.patch('/admin/templates/:id', requireMemeologyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, boxCount, tier, categories } = req.body;

    const template = await redis.hGetAll(MEMEOLOGY_KEYS.customTemplate(id));
    if (!template || Object.keys(template).length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // Update fields
    if (name) template.name = name.trim();
    if (boxCount) template.box_count = parseInt(boxCount);
    if (tier) template.tier = tier;
    if (categories) {
      template.categories = Array.isArray(categories) ? JSON.stringify(categories) : JSON.stringify([categories]);
    }
    template.updatedAt = new Date().toISOString();

    await redis.hSet(MEMEOLOGY_KEYS.customTemplate(id), template);

    console.log(`✏️ Custom template updated: ${template.name} (${id})`);

    res.json({
      success: true,
      message: 'Template updated successfully',
      template
    });

  } catch (error) {
    console.error('Error updating custom template:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/memeology/templates/custom - Get custom templates (for frontend, no admin required)
router.get('/templates/custom', async (req, res) => {
  try {
    const { tier } = req.query;
    const userTier = tier || 'free';

    const templateIds = await redis.lRange(MEMEOLOGY_KEYS.customTemplates, 0, -1);
    const templates = [];

    for (const id of templateIds) {
      const template = await redis.hGetAll(MEMEOLOGY_KEYS.customTemplate(id));
      if (template && Object.keys(template).length > 0) {
        // Filter by tier
        const templateTier = template.tier || 'free';
        const tierOrder = ['free', 'waldocoin', 'premium', 'gold', 'platinum', 'king'];
        const userTierIndex = tierOrder.indexOf(userTier);
        const templateTierIndex = tierOrder.indexOf(templateTier);

        if (userTierIndex >= templateTierIndex) {
          // Parse categories
          if (typeof template.categories === 'string') {
            try {
              template.categories = JSON.parse(template.categories);
            } catch (e) {
              template.categories = [template.categories];
            }
          }
          templates.push(template);
        }
      }
    }

    res.json({
      success: true,
      templates,
      count: templates.length,
      tier: userTier
    });

  } catch (error) {
    console.error('Error getting custom templates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CREATOR TEMPLATE SUBMISSION SYSTEM
// Premium users can submit up to 3 templates/month for admin review
// Approved templates earn creators 100 WLO per use
// ============================================================================

// POST /api/memeology/templates/submit - Submit a template for review (premium users only)
router.post('/templates/submit', async (req, res) => {
  try {
    const { wallet, imageData, name, categories } = req.body;

    if (!wallet || !imageData || !name) {
      return res.status(400).json({ error: 'Wallet, image data, and name are required' });
    }

    // Check user tier - only premium+ tiers can submit (premium, gold, platinum, king)
    const tierInfo = await getUserTier(wallet);
    const allowedTiers = ['premium', 'gold', 'platinum', 'king'];
    if (!allowedTiers.includes(tierInfo.tier)) {
      return res.status(403).json({
        error: 'Template submission requires Premium tier or higher. Subscribe for $5/month to unlock!',
        tier: tierInfo.tier
      });
    }

    // Check monthly submission limit (3 per month)
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const submissionsKey = MEMEOLOGY_KEYS.creatorSubmissions(wallet, currentMonth);
    const currentSubmissions = parseInt(await redis.get(submissionsKey) || '0', 10);

    if (currentSubmissions >= 3) {
      return res.status(429).json({
        error: 'Monthly submission limit reached (3 templates/month). Try again next month!',
        limit: 3,
        used: currentSubmissions
      });
    }

    // Upload to Cloudinary if available
    let imageUrl = imageData;
    if (cloudinary && imageData.startsWith('data:')) {
      try {
        const uploadResult = await cloudinary.uploader.upload(imageData, {
          folder: 'memeology/creator-submissions',
          public_id: `template_${Date.now()}`
        });
        imageUrl = uploadResult.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload failed:', uploadErr.message);
        // Continue with base64 if Cloudinary fails
      }
    }

    const templateId = `creator_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // All values must be strings for Redis hSet
    const template = {
      id: templateId,
      name,
      url: imageUrl,
      categories: JSON.stringify(categories || ['community']),
      creatorWallet: wallet,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      uses: '0'
    };

    // Store pending template
    await redis.hSet(MEMEOLOGY_KEYS.pendingTemplate(templateId), template);
    await redis.lPush(MEMEOLOGY_KEYS.pendingTemplates, templateId);

    // Increment monthly submission count
    await redis.incr(submissionsKey);
    // Set expiry to 60 days so it auto-cleans
    await redis.expire(submissionsKey, 60 * 24 * 60 * 60);

    console.log(`📤 Template submitted: ${templateId} by ${wallet.slice(0, 10)}... (${currentSubmissions + 1}/3 this month)`);

    res.json({
      success: true,
      templateId,
      message: 'Template submitted for review! You\'ll earn 100 WLO each time someone uses it once approved.',
      submissionsRemaining: 3 - currentSubmissions - 1
    });

  } catch (error) {
    console.error('Error submitting template:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/templates/submissions - Get user's submitted templates
router.get('/templates/submissions', async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet required' });
    }

    // Get all pending templates for this user
    const pendingIds = await redis.lRange(MEMEOLOGY_KEYS.pendingTemplates, 0, -1);
    const pendingTemplates = [];

    for (const id of pendingIds) {
      const template = await redis.hGetAll(MEMEOLOGY_KEYS.pendingTemplate(id));
      if (template && template.creatorWallet === wallet) {
        pendingTemplates.push(template);
      }
    }

    // Get approved creator templates for this user
    const approvedIds = await redis.lRange(MEMEOLOGY_KEYS.approvedCreatorTemplates, 0, -1);
    const approvedTemplates = [];

    for (const id of approvedIds) {
      const template = await redis.hGetAll(MEMEOLOGY_KEYS.creatorTemplate(id));
      if (template && template.creatorWallet === wallet) {
        approvedTemplates.push(template);
      }
    }

    // Get total earnings
    const earnings = parseInt(await redis.get(MEMEOLOGY_KEYS.creatorEarnings(wallet)) || '0', 10);

    // Get this month's submissions
    const currentMonth = new Date().toISOString().slice(0, 7);
    const submissionsThisMonth = parseInt(await redis.get(MEMEOLOGY_KEYS.creatorSubmissions(wallet, currentMonth)) || '0', 10);

    res.json({
      success: true,
      pending: pendingTemplates,
      approved: approvedTemplates,
      totalEarnings: earnings,
      submissionsThisMonth,
      submissionsRemaining: Math.max(0, 3 - submissionsThisMonth)
    });

  } catch (error) {
    console.error('Error getting submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/memeology/admin/templates/pending - Get pending templates for admin review
router.get('/admin/templates/pending', requireMemeologyAdmin, async (req, res) => {
  try {
    const pendingIds = await redis.lRange(MEMEOLOGY_KEYS.pendingTemplates, 0, -1);
    const templates = [];

    for (const id of pendingIds) {
      const template = await redis.hGetAll(MEMEOLOGY_KEYS.pendingTemplate(id));
      if (template && Object.keys(template).length > 0) {
        templates.push(template);
      }
    }

    res.json({
      success: true,
      templates,
      count: templates.length
    });

  } catch (error) {
    console.error('Error getting pending templates:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/admin/templates/review - Approve or reject a pending template
router.post('/admin/templates/review', requireMemeologyAdmin, async (req, res) => {
  try {
    const { templateId, action, reason } = req.body;

    if (!templateId || !action) {
      return res.status(400).json({ error: 'templateId and action (approve/reject) required' });
    }

    const template = await redis.hGetAll(MEMEOLOGY_KEYS.pendingTemplate(templateId));
    if (!template || Object.keys(template).length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Remove from pending list
    await redis.lRem(MEMEOLOGY_KEYS.pendingTemplates, 0, templateId);

    if (action === 'approve') {
      // Move to approved creator templates
      template.status = 'approved';
      template.approvedAt = new Date().toISOString();
      template.uses = '0';

      await redis.hSet(MEMEOLOGY_KEYS.creatorTemplate(templateId), template);
      await redis.lPush(MEMEOLOGY_KEYS.approvedCreatorTemplates, templateId);

      // Also add to custom templates so it shows in the main gallery
      await redis.hSet(MEMEOLOGY_KEYS.customTemplate(templateId), {
        ...template,
        tier: 'free', // Available to all users
        isCreatorTemplate: 'true'
      });
      await redis.lPush(MEMEOLOGY_KEYS.customTemplates, templateId);

      console.log(`✅ Template approved: ${templateId} by ${template.creatorWallet?.slice(0, 10)}...`);

      res.json({
        success: true,
        message: 'Template approved and added to gallery!',
        template
      });
    } else if (action === 'reject') {
      // Just remove from pending (already done above)
      await redis.del(MEMEOLOGY_KEYS.pendingTemplate(templateId));  // Note: 'del' is lowercase in redis v4

      console.log(`❌ Template rejected: ${templateId} - ${reason || 'No reason given'}`);

      res.json({
        success: true,
        message: 'Template rejected',
        reason
      });
    } else {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
    }

  } catch (error) {
    console.error('Error reviewing template:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/memeology/templates/use - Track template usage and pay creator
router.post('/templates/use', async (req, res) => {
  try {
    const { templateId, wallet } = req.body;

    if (!templateId) {
      return res.json({ success: true }); // Silently succeed for non-tracked templates
    }

    // Check if this is a creator template
    const creatorTemplate = await redis.hGetAll(MEMEOLOGY_KEYS.creatorTemplate(templateId));
    if (!creatorTemplate || Object.keys(creatorTemplate).length === 0) {
      return res.json({ success: true }); // Not a creator template, just succeed
    }

    // Increment usage count
    const newUses = await redis.hincrby(MEMEOLOGY_KEYS.creatorTemplate(templateId), 'uses', 1);

    // Credit creator with 100 WLO
    const creatorWallet = creatorTemplate.creatorWallet;
    if (creatorWallet && creatorWallet !== wallet) { // Don't pay creator for their own usage
      await redis.incrby(MEMEOLOGY_KEYS.creatorEarnings(creatorWallet), CREATOR_PAYOUT_PER_USE);
      console.log(`💰 Creator ${creatorWallet.slice(0, 10)}... earned ${CREATOR_PAYOUT_PER_USE} WLO for template use (total uses: ${newUses})`);
    }

    res.json({
      success: true,
      templateUses: newUses,
      creatorEarned: CREATOR_PAYOUT_PER_USE
    });

  } catch (error) {
    console.error('Error tracking template use:', error);
    res.json({ success: true }); // Don't fail the meme creation
  }
});

// GET /api/memeology/creator/earnings - Get creator earnings and request payout
router.get('/creator/earnings', async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet required' });
    }

    const earnings = parseInt(await redis.get(MEMEOLOGY_KEYS.creatorEarnings(wallet)) || '0', 10);

    res.json({
      success: true,
      earnings,
      earningsUsd: (earnings * 0.001).toFixed(2), // At $0.001 per WLO
      minPayout: 1000, // Minimum 1000 WLO ($1) to request payout
      canRequestPayout: earnings >= 1000
    });

  } catch (error) {
    console.error('Error getting creator earnings:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

