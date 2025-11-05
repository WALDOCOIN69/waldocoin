import express from "express";
import { redis } from "../../redisClient.js";
import {
  assignKingNFT,
  revokeKingNFT,
  getKingNFTHolders,
  isKingNFTHolder
} from "../../utils/nftUtilities.js";

const router = express.Router();

// ============================================================================
// 👑 KING NFT MANAGEMENT (Admin Only)
// ============================================================================

/**
 * GET /api/admin/king-nft/holders
 * Get all King NFT holders (limited to 5)
 */
router.get("/holders", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const holders = await getKingNFTHolders();
    const kingCount = await redis.get('system:king_nft_count') || 0;

    res.json({
      success: true,
      kingCount: parseInt(kingCount),
      maxKings: 5,
      holders
    });
  } catch (error) {
    console.error("❌ Error getting King NFT holders:", error);
    res.status(500).json({ success: false, error: "Failed to get King NFT holders" });
  }
});

/**
 * POST /api/admin/king-nft/assign
 * Assign a King NFT to a wallet
 */
router.post("/assign", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { wallet, nftId } = req.body;

    if (!wallet || !nftId) {
      return res.status(400).json({ success: false, error: "Missing wallet or nftId" });
    }

    if (wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    const result = await assignKingNFT(wallet, nftId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: `👑 King NFT assigned to ${wallet.substring(0, 10)}...${wallet.substring(wallet.length - 6)}`,
      nftId
    });
  } catch (error) {
    console.error("❌ Error assigning King NFT:", error);
    res.status(500).json({ success: false, error: "Failed to assign King NFT" });
  }
});

/**
 * POST /api/admin/king-nft/revoke
 * Revoke a King NFT from a wallet
 */
router.post("/revoke", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { wallet } = req.body;

    if (!wallet) {
      return res.status(400).json({ success: false, error: "Missing wallet" });
    }

    if (wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    const result = await revokeKingNFT(wallet);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: `👑 King NFT revoked from ${wallet.substring(0, 10)}...${wallet.substring(wallet.length - 6)}`
    });
  } catch (error) {
    console.error("❌ Error revoking King NFT:", error);
    res.status(500).json({ success: false, error: "Failed to revoke King NFT" });
  }
});

/**
 * GET /api/admin/king-nft/check/:wallet
 * Check if a wallet holds a King NFT
 */
router.get("/check/:wallet", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const { wallet } = req.params;

    if (!wallet || wallet.length < 25) {
      return res.status(400).json({ success: false, error: "Invalid wallet address" });
    }

    const isKing = await isKingNFTHolder(wallet);
    const nftId = isKing ? await redis.get(`wallet:king_nft:${wallet}`) : null;

    res.json({
      success: true,
      wallet: wallet.substring(0, 10) + "..." + wallet.substring(wallet.length - 6),
      isKingHolder: isKing,
      nftId: nftId || null
    });
  } catch (error) {
    console.error("❌ Error checking King NFT status:", error);
    res.status(500).json({ success: false, error: "Failed to check King NFT status" });
  }
});

/**
 * GET /api/admin/king-nft/status
 * Get King NFT system status
 */
router.get("/status", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    const kingCount = await redis.get('system:king_nft_count') || 0;
    const holders = await getKingNFTHolders();

    res.json({
      success: true,
      status: {
        totalKings: parseInt(kingCount),
        maxKings: 5,
        slotsAvailable: 5 - parseInt(kingCount),
        holders: holders.length,
        kingList: holders
      }
    });
  } catch (error) {
    console.error("❌ Error getting King NFT status:", error);
    res.status(500).json({ success: false, error: "Failed to get King NFT status" });
  }
});

export default router;

