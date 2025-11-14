// routes/memeology.js
// Memeology - AI-powered meme generator routes
import express from 'express';
import axios from 'axios';
import xrpl from 'xrpl';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Configuration
const IMGFLIP_USERNAME = process.env.IMGFLIP_USERNAME || 'waldolabs';
const IMGFLIP_PASSWORD = process.env.IMGFLIP_PASSWORD || 'waldolabs123';
const XRPL_SERVER = process.env.XRPL_SERVER || 'https://s1.ripple.com:51234';
const WLO_ISSUER = process.env.WLO_ISSUER || process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const WLO_CURRENCY = 'WLO';

// In-memory storage (replace with Redis/database in production)
const xummSessions = new Map();
const userMemeCount = new Map();
const premiumSubscriptions = new Map();

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

    const wloLine = response.result.lines.find(
      line => line.currency === WLO_CURRENCY && line.account === WLO_ISSUER
    );

    return wloLine ? parseFloat(wloLine.balance) : 0;
  } catch (error) {
    console.error('Error getting WLO balance:', error);
    return 0;
  }
}

// Helper: Check user tier
async function checkUserTier(wallet) {
  try {
    const wloBalance = await getWLOBalance(wallet);
    
    // Check premium subscription
    const now = new Date();
    let tier = 'free';
    let premiumExpires = null;

    if (premiumSubscriptions.has(wallet)) {
      const sub = premiumSubscriptions.get(wallet);
      if (new Date(sub.expiresAt) > now) {
        tier = 'premium';
        premiumExpires = sub.expiresAt;
      }
    }

    // Check WLO balance for WALDOCOIN tier (if not premium)
    if (tier !== 'premium' && wloBalance >= 1000) {
      tier = 'waldocoin';
    }

    // Set features based on tier
    let features = {};
    if (tier === 'premium') {
      features = {
        templates: 'unlimited',
        memesPerDay: 'unlimited',
        feePerMeme: 'none',
        aiSuggestions: 'unlimited',
        customFonts: true,
        noWatermark: true,
        nftArtIntegration: true
      };
    } else if (tier === 'waldocoin') {
      features = {
        templates: 150,
        memesPerDay: 'unlimited',
        feePerMeme: '0.1 WLO',
        aiSuggestions: '50/day',
        customFonts: true,
        noWatermark: false,
        nftArtIntegration: true
      };
    } else {
      features = {
        templates: 50,
        memesPerDay: 10,
        feePerMeme: 'none',
        aiSuggestions: '5/day',
        customFonts: false,
        noWatermark: false,
        nftArtIntegration: false
      };
    }

    return {
      tier,
      wallet,
      wloBalance,
      premiumExpires,
      features
    };
  } catch (error) {
    console.error('Error checking user tier:', error);
    return {
      tier: 'free',
      wallet,
      wloBalance: 0,
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
    const key = `${wallet}:${today}`;
    const count = userMemeCount.get(key) || 0;

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
    const response = await axios.get('https://api.imgflip.com/get_memes');

    if (response.data.success) {
      res.json({
        success: true,
        memes: response.data.data.memes
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  } catch (error) {
    console.error('Error in /templates/imgflip:', error);
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

      // Check usage limits for free tier
      if (tier === 'free') {
        const today = new Date().toISOString().split('T')[0];
        const key = `${userId}:${today}`;
        const count = userMemeCount.get(key) || 0;

        if (count >= 10) {
          return res.status(429).json({
            error: 'Daily limit reached (10 memes/day). Upgrade to WALDOCOIN or Premium for unlimited memes!'
          });
        }
      }

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
        const key = `${userId}:${today}`;
        userMemeCount.set(key, (userMemeCount.get(key) || 0) + 1);
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

// POST /api/memeology/premium/subscribe - Subscribe to Premium tier
router.post('/premium/subscribe', async (req, res) => {
  try {
    const { wallet, paymentTx } = req.body;

    if (!wallet || !paymentTx) {
      return res.status(400).json({ error: 'Wallet and payment transaction required' });
    }

    // Verify payment transaction on XRPL
    const client = new xrpl.Client(XRPL_SERVER);
    await client.connect();

    const txResponse = await client.request({
      command: 'tx',
      transaction: paymentTx
    });

    await client.disconnect();

    if (!txResponse.result) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    // TODO: Verify transaction details
    // - Check amount is correct ($5 equivalent)
    // - Check destination is our wallet
    // - Check transaction is validated

    // Add 30 days to subscription
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    premiumSubscriptions.set(wallet, {
      expiresAt: expiresAt.toISOString(),
      paymentTx,
      subscribedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      tier: 'premium',
      expiresAt: expiresAt.toISOString(),
      message: 'Premium subscription activated! Enjoy unlimited memes!'
    });
  } catch (error) {
    console.error('Error in /premium/subscribe:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

