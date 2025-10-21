import { redis } from "../redisClient.js";
import { xrpSendWaldo } from "./sendWaldo.js";

console.log("🧩 Loaded: utils/battleRefunds.js");

/**
 * Refund challenger for unaccepted battle
 * @param {string} battleId - Battle ID
 * @param {string} challengerWallet - Challenger wallet address
 * @param {number} amount - Amount to refund (in WLO)
 * @param {string} reason - Reason for refund
 */
export async function refundChallenger(battleId, challengerWallet, amount, reason = "Battle unaccepted") {
  try {
    console.log(`💰 Refunding challenger ${challengerWallet}: ${amount} WLO for battle ${battleId}`);
    
    await xrpSendWaldo(challengerWallet, amount);
    
    // Log refund in battle data
    const battleKey = `battle:${battleId}:data`;
    await redis.hset(battleKey, {
      challengerRefunded: true,
      challengerRefundAmount: amount,
      challengerRefundReason: reason,
      challengerRefundedAt: Date.now()
    });
    
    console.log(`✅ Challenger refund successful: ${challengerWallet} - ${amount} WLO`);
    return true;
  } catch (error) {
    console.error(`❌ Challenger refund failed: ${challengerWallet} - ${amount} WLO:`, error);
    return false;
  }
}

/**
 * Refund acceptor for canceled battle
 * @param {string} battleId - Battle ID
 * @param {string} acceptorWallet - Acceptor wallet address
 * @param {number} amount - Amount to refund (in WLO)
 * @param {string} reason - Reason for refund
 */
export async function refundAcceptor(battleId, acceptorWallet, amount, reason = "Battle canceled") {
  try {
    console.log(`💰 Refunding acceptor ${acceptorWallet}: ${amount} WLO for battle ${battleId}`);
    
    await xrpSendWaldo(acceptorWallet, amount);
    
    // Log refund in battle data
    const battleKey = `battle:${battleId}:data`;
    await redis.hset(battleKey, {
      acceptorRefunded: true,
      acceptorRefundAmount: amount,
      acceptorRefundReason: reason,
      acceptorRefundedAt: Date.now()
    });
    
    console.log(`✅ Acceptor refund successful: ${acceptorWallet} - ${amount} WLO`);
    return true;
  } catch (error) {
    console.error(`❌ Acceptor refund failed: ${acceptorWallet} - ${amount} WLO:`, error);
    return false;
  }
}

/**
 * Refund all voters for canceled battle
 * @param {string} battleId - Battle ID
 * @param {number} voteAmount - Amount each voter paid (in WLO)
 */
export async function refundAllVoters(battleId, voteAmount = 30000) {
  try {
    console.log(`💰 Refunding all voters for battle ${battleId}: ${voteAmount} WLO each`);
    
    // Get all voters from both sides
    const meme1Voters = await redis.sMembers(`battle:${battleId}:voters:meme1`);
    const meme2Voters = await redis.sMembers(`battle:${battleId}:voters:meme2`);
    const allVoters = [...meme1Voters, ...meme2Voters];
    
    let refundedCount = 0;
    let failedCount = 0;
    
    for (const voter of allVoters) {
      try {
        await xrpSendWaldo(voter, voteAmount);
        console.log(`✅ Voter refund successful: ${voter} - ${voteAmount} WLO`);
        refundedCount++;
      } catch (error) {
        console.error(`❌ Voter refund failed: ${voter} - ${voteAmount} WLO:`, error);
        failedCount++;
      }
    }
    
    // Log refund summary in battle data
    const battleKey = `battle:${battleId}:data`;
    await redis.hset(battleKey, {
      votersRefunded: true,
      votersRefundedCount: refundedCount,
      votersRefundFailed: failedCount,
      voterRefundAmount: voteAmount,
      votersRefundedAt: Date.now()
    });
    
    console.log(`✅ Voter refunds completed: ${refundedCount} successful, ${failedCount} failed`);
    return { refundedCount, failedCount, totalVoters: allVoters.length };
  } catch (error) {
    console.error(`❌ Voter refund process failed for battle ${battleId}:`, error);
    return { refundedCount: 0, failedCount: 0, totalVoters: 0 };
  }
}

/**
 * Process full battle refund (challenger + acceptor + all voters)
 * @param {string} battleId - Battle ID
 * @param {string} reason - Reason for refund
 */
export async function refundFullBattle(battleId, reason = "Battle canceled") {
  try {
    console.log(`🔄 Processing full battle refund: ${battleId} - ${reason}`);
    
    const battleKey = `battle:${battleId}:data`;
    const battle = await redis.hgetall(battleKey);
    
    if (!battle || !battle.challenger) {
      console.error(`❌ Battle not found or invalid: ${battleId}`);
      return false;
    }
    
    const { startFeeWLO, acceptFeeWLO, voteFeeWLO } = await (await import("./config.js")).getBattleFees();
    
    // Refund challenger (start fee)
    if (battle.challenger && !battle.challengerRefunded) {
      await refundChallenger(battleId, battle.challenger, startFeeWLO, reason);
    }
    
    // Refund acceptor (accept fee) if battle was accepted
    if (battle.acceptor && !battle.acceptorRefunded) {
      await refundAcceptor(battleId, battle.acceptor, acceptFeeWLO, reason);
    }
    
    // Refund all voters
    if (!battle.votersRefunded) {
      await refundAllVoters(battleId, voteFeeWLO);
    }
    
    // Mark battle as fully refunded
    await redis.hset(battleKey, {
      status: "refunded",
      refundReason: reason,
      fullRefundProcessedAt: Date.now()
    });
    
    console.log(`✅ Full battle refund completed: ${battleId}`);
    return true;
  } catch (error) {
    console.error(`❌ Full battle refund failed: ${battleId}:`, error);
    return false;
  }
}

/**
 * Check and process expired battles for refunds
 */
export async function processExpiredBattles() {
  try {
    console.log("🔍 Checking for expired battles to refund...");
    
    const keys = await redis.keys("battle:*:data");
    const now = Date.now();
    const EXPIRY_TIME = 10 * 60 * 60 * 1000; // 10 hours in milliseconds
    
    let processedCount = 0;
    
    for (const key of keys) {
      const battle = await redis.hgetall(key);
      
      if (!battle || !battle.createdAt || battle.status !== "pending") {
        continue;
      }
      
      const createdAt = parseInt(battle.createdAt);
      const isExpired = (now - createdAt) > EXPIRY_TIME;
      
      if (isExpired && !battle.challengerRefunded) {
        const battleId = key.replace("battle:", "").replace(":data", "");
        console.log(`⏰ Processing expired battle: ${battleId}`);
        
        const { startFeeWLO } = await (await import("./config.js")).getBattleFees();
        await refundChallenger(battleId, battle.challenger, startFeeWLO, "Battle expired (10+ hours unaccepted)");
        
        // Mark battle as expired
        await redis.hset(key, {
          status: "expired",
          expiredAt: now
        });
        
        processedCount++;
      }
    }
    
    if (processedCount > 0) {
      console.log(`✅ Processed ${processedCount} expired battles`);
    } else {
      console.log("✅ No expired battles found");
    }
    
    return processedCount;
  } catch (error) {
    console.error("❌ Error processing expired battles:", error);
    return 0;
  }
}
