import express from "express";
import { triggerExpiredBattleRefund } from "../../cron/expiredBattleRefunder.js";
import { refundFullBattle, refundChallenger, refundAcceptor, refundAllVoters } from "../../utils/battleRefunds.js";

const router = express.Router();

console.log("🧩 Loaded: routes/admin/battleRefunds.js");

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(403).json({ success: false, error: "Unauthorized" });
  }
  next();
};

// POST /api/admin/battle-refunds/trigger-expired - Manually trigger expired battle refunds
router.post("/trigger-expired", requireAdmin, async (req, res) => {
  try {
    console.log("🔧 Admin triggered expired battle refund check");
    const processedCount = await triggerExpiredBattleRefund();
    
    return res.json({
      success: true,
      message: `Expired battle refund check completed`,
      processedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin expired battle refund failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process expired battles",
      detail: error.message
    });
  }
});

// POST /api/admin/battle-refunds/full-battle - Refund entire battle
router.post("/full-battle", requireAdmin, async (req, res) => {
  try {
    const { battleId, reason } = req.body;
    
    if (!battleId) {
      return res.status(400).json({
        success: false,
        error: "Missing battleId"
      });
    }
    
    console.log(`🔧 Admin triggered full battle refund: ${battleId}`);
    const success = await refundFullBattle(battleId, reason || "Admin manual refund");
    
    if (success) {
      return res.json({
        success: true,
        message: `Full battle refund completed for ${battleId}`,
        battleId,
        reason: reason || "Admin manual refund",
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Failed to refund battle ${battleId}`
      });
    }
  } catch (error) {
    console.error("❌ Admin full battle refund failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process full battle refund",
      detail: error.message
    });
  }
});

// POST /api/admin/battle-refunds/challenger - Refund challenger only
router.post("/challenger", requireAdmin, async (req, res) => {
  try {
    const { battleId, challengerWallet, amount, reason } = req.body;
    
    if (!battleId || !challengerWallet || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: battleId, challengerWallet, amount"
      });
    }
    
    console.log(`🔧 Admin triggered challenger refund: ${challengerWallet} - ${amount} WLO`);
    const success = await refundChallenger(battleId, challengerWallet, amount, reason || "Admin manual refund");
    
    if (success) {
      return res.json({
        success: true,
        message: `Challenger refund completed`,
        battleId,
        challengerWallet,
        amount,
        reason: reason || "Admin manual refund",
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Failed to refund challenger ${challengerWallet}`
      });
    }
  } catch (error) {
    console.error("❌ Admin challenger refund failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process challenger refund",
      detail: error.message
    });
  }
});

// POST /api/admin/battle-refunds/acceptor - Refund acceptor only
router.post("/acceptor", requireAdmin, async (req, res) => {
  try {
    const { battleId, acceptorWallet, amount, reason } = req.body;
    
    if (!battleId || !acceptorWallet || !amount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: battleId, acceptorWallet, amount"
      });
    }
    
    console.log(`🔧 Admin triggered acceptor refund: ${acceptorWallet} - ${amount} WLO`);
    const success = await refundAcceptor(battleId, acceptorWallet, amount, reason || "Admin manual refund");
    
    if (success) {
      return res.json({
        success: true,
        message: `Acceptor refund completed`,
        battleId,
        acceptorWallet,
        amount,
        reason: reason || "Admin manual refund",
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Failed to refund acceptor ${acceptorWallet}`
      });
    }
  } catch (error) {
    console.error("❌ Admin acceptor refund failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process acceptor refund",
      detail: error.message
    });
  }
});

// POST /api/admin/battle-refunds/voters - Refund all voters
router.post("/voters", requireAdmin, async (req, res) => {
  try {
    const { battleId, voteAmount } = req.body;
    
    if (!battleId) {
      return res.status(400).json({
        success: false,
        error: "Missing battleId"
      });
    }
    
    console.log(`🔧 Admin triggered voter refunds for battle: ${battleId}`);
    const result = await refundAllVoters(battleId, voteAmount || 30000);
    
    return res.json({
      success: true,
      message: `Voter refunds completed for battle ${battleId}`,
      battleId,
      voteAmount: voteAmount || 30000,
      refundedCount: result.refundedCount,
      failedCount: result.failedCount,
      totalVoters: result.totalVoters,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Admin voter refunds failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to process voter refunds",
      detail: error.message
    });
  }
});

export default router;
