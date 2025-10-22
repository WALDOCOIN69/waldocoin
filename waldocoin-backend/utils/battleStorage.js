import { redis } from "../redisClient.js";
import { v4 as uuidv4 } from "uuid";

console.log("🧩 Loaded: utils/battleStorage.js");

/**
 * Standardized Battle Storage Utility
 * 
 * This utility provides consistent data storage patterns for all battle operations
 * and prevents race conditions through atomic operations.
 */

// Standard Redis key patterns
export const BATTLE_KEYS = {
  // Battle data (hash storage)
  data: (battleId) => `battle:${battleId}:data`,
  
  // Battle locks (for atomic operations)
  lock: (battleId) => `battle:${battleId}:lock`,
  createLock: () => `battle:create:lock`,
  
  // Vote tracking
  vote: (battleId, wallet) => `battle:${battleId}:vote:${wallet}`,
  voteCount: (battleId, side) => `battle:${battleId}:count:${side}`,
  voters: (battleId, side) => `battle:${battleId}:voters:${side}`,
  
  // Battle management
  current: () => `battle:current`,
  pending: () => `battle:pending:*`,
  active: () => `battle:active:*`,
  
  // Payment tracking
  payment: (battleId, wallet) => `battle:${battleId}:payment:${wallet}`,
  
  // Cleanup tracking
  cleanup: (battleId) => `battle:${battleId}:cleanup`
};

/**
 * Acquire a Redis lock with timeout
 * @param {string} lockKey - Redis key for the lock
 * @param {number} timeoutMs - Lock timeout in milliseconds
 * @param {string} lockValue - Unique value for the lock
 * @returns {boolean} - True if lock acquired
 */
export async function acquireLock(lockKey, timeoutMs = 30000, lockValue = uuidv4()) {
  try {
    const result = await redis.set(lockKey, lockValue, {
      PX: timeoutMs, // Expire in milliseconds
      NX: true       // Only set if not exists
    });
    
    if (result === 'OK') {
      console.log(`🔒 Lock acquired: ${lockKey} = ${lockValue}`);
      return { acquired: true, lockValue };
    }
    
    console.log(`❌ Lock acquisition failed: ${lockKey}`);
    return { acquired: false, lockValue: null };
  } catch (error) {
    console.error(`❌ Lock acquisition error: ${lockKey}:`, error);
    return { acquired: false, lockValue: null };
  }
}

/**
 * Release a Redis lock
 * @param {string} lockKey - Redis key for the lock
 * @param {string} lockValue - Value used when acquiring the lock
 * @returns {boolean} - True if lock released
 */
export async function releaseLock(lockKey, lockValue) {
  try {
    // Lua script to atomically check and delete lock
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await redis.eval(luaScript, 1, lockKey, lockValue);
    
    if (result === 1) {
      console.log(`🔓 Lock released: ${lockKey}`);
      return true;
    }
    
    console.log(`⚠️ Lock release failed (may have expired): ${lockKey}`);
    return false;
  } catch (error) {
    console.error(`❌ Lock release error: ${lockKey}:`, error);
    return false;
  }
}

/**
 * Create a new battle with atomic operations
 * @param {Object} battleData - Battle data object
 * @returns {Object} - { success: boolean, battleId?: string, error?: string }
 */
export async function createBattle(battleData) {
  const createLockKey = BATTLE_KEYS.createLock();
  const { acquired, lockValue } = await acquireLock(createLockKey, 10000);
  
  if (!acquired) {
    return { success: false, error: "System busy, please try again" };
  }
  
  try {
    const battleId = battleData.battleId || uuidv4();
    const battleKey = BATTLE_KEYS.data(battleId);
    
    // Check if battle already exists
    const exists = await redis.exists(battleKey);
    if (exists) {
      return { success: false, error: "Battle ID conflict, please try again" };
    }
    
    // Standardized battle data structure
    const standardBattleData = {
      battleId,
      challenger: battleData.challenger,
      challengerHandle: battleData.challengerHandle || null,
      challengerTweetId: battleData.challengerTweetId,
      acceptor: battleData.acceptor || null,
      acceptorHandle: battleData.acceptorHandle || null,
      acceptorTweetId: battleData.acceptorTweetId || null,
      status: battleData.status || "pending",
      type: battleData.type || "challenge", // "challenge" or "open"
      createdAt: battleData.createdAt || Date.now(),
      acceptedAt: battleData.acceptedAt || null,
      endsAt: battleData.endsAt || null,
      expiresAt: battleData.expiresAt || null,
      votes: 0,
      totalVoters: 0,
      winner: null,
      payoutAt: null,
      refunded: false,
      metadata: battleData.metadata || {}
    };
    
    // Store battle data as hash for efficient updates
    await redis.hset(battleKey, standardBattleData);
    
    // Set expiry (24 hours for active battles, 12 hours for pending)
    const expiryHours = standardBattleData.status === "pending" ? 12 : 24;
    await redis.expire(battleKey, expiryHours * 60 * 60);
    
    // Initialize vote counters
    await redis.set(BATTLE_KEYS.voteCount(battleId, "A"), 0);
    await redis.set(BATTLE_KEYS.voteCount(battleId, "B"), 0);
    
    console.log(`⚔️ Battle created: ${battleId} (${standardBattleData.type})`);
    
    return { success: true, battleId, battleData: standardBattleData };
    
  } catch (error) {
    console.error(`❌ Battle creation error:`, error);
    return { success: false, error: "Failed to create battle" };
  } finally {
    await releaseLock(createLockKey, lockValue);
  }
}

/**
 * Update battle data atomically
 * @param {string} battleId - Battle ID
 * @param {Object} updates - Fields to update
 * @returns {Object} - { success: boolean, error?: string }
 */
export async function updateBattle(battleId, updates) {
  const battleLockKey = BATTLE_KEYS.lock(battleId);
  const { acquired, lockValue } = await acquireLock(battleLockKey, 5000);
  
  if (!acquired) {
    return { success: false, error: "Battle is being updated, please try again" };
  }
  
  try {
    const battleKey = BATTLE_KEYS.data(battleId);
    
    // Check if battle exists
    const exists = await redis.exists(battleKey);
    if (!exists) {
      return { success: false, error: "Battle not found" };
    }
    
    // Update fields
    await redis.hset(battleKey, updates);
    
    console.log(`⚔️ Battle updated: ${battleId}`, Object.keys(updates));
    
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Battle update error: ${battleId}:`, error);
    return { success: false, error: "Failed to update battle" };
  } finally {
    await releaseLock(battleLockKey, lockValue);
  }
}

/**
 * Get battle data
 * @param {string} battleId - Battle ID
 * @returns {Object} - Battle data or null
 */
export async function getBattle(battleId) {
  try {
    const battleKey = BATTLE_KEYS.data(battleId);
    const battleData = await redis.hgetall(battleKey);
    
    if (!battleData || Object.keys(battleData).length === 0) {
      return null;
    }
    
    // Convert numeric fields back to numbers
    const numericFields = ['createdAt', 'acceptedAt', 'endsAt', 'expiresAt', 'votes', 'totalVoters', 'payoutAt'];
    numericFields.forEach(field => {
      if (battleData[field] && battleData[field] !== 'null') {
        battleData[field] = parseInt(battleData[field]);
      }
    });
    
    // Convert boolean fields
    battleData.refunded = battleData.refunded === 'true';
    
    return battleData;
    
  } catch (error) {
    console.error(`❌ Get battle error: ${battleId}:`, error);
    return null;
  }
}

/**
 * Record a vote atomically
 * @param {string} battleId - Battle ID
 * @param {string} wallet - Voter wallet
 * @param {string} vote - Vote choice ("A" or "B")
 * @returns {Object} - { success: boolean, error?: string }
 */
export async function recordVote(battleId, wallet, vote) {
  const battleLockKey = BATTLE_KEYS.lock(battleId);
  const { acquired, lockValue } = await acquireLock(battleLockKey, 5000);
  
  if (!acquired) {
    return { success: false, error: "Voting is busy, please try again" };
  }
  
  try {
    const voteKey = BATTLE_KEYS.vote(battleId, wallet);
    
    // Check if already voted
    const existingVote = await redis.get(voteKey);
    if (existingVote) {
      return { success: false, error: "You have already voted in this battle" };
    }
    
    // Record vote with 7-day expiry
    await redis.set(voteKey, JSON.stringify({ 
      vote, 
      timestamp: Date.now(),
      battleId 
    }), { EX: 60 * 60 * 24 * 7 });
    
    // Increment vote count
    const countKey = BATTLE_KEYS.voteCount(battleId, vote);
    await redis.incr(countKey);
    
    // Add to voter set
    const votersKey = BATTLE_KEYS.voters(battleId, vote);
    await redis.sadd(votersKey, wallet);
    
    // Update total vote count in battle data
    const battleKey = BATTLE_KEYS.data(battleId);
    await redis.hincrby(battleKey, 'votes', 1);
    await redis.hincrby(battleKey, 'totalVoters', 1);
    
    console.log(`🗳️ Vote recorded: ${battleId} - ${wallet} voted ${vote}`);
    
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Vote recording error: ${battleId}:`, error);
    return { success: false, error: "Failed to record vote" };
  } finally {
    await releaseLock(battleLockKey, lockValue);
  }
}

/**
 * Get vote counts for a battle
 * @param {string} battleId - Battle ID
 * @returns {Object} - { votesA: number, votesB: number, totalVotes: number }
 */
export async function getVoteCounts(battleId) {
  try {
    const [votesA, votesB] = await Promise.all([
      redis.get(BATTLE_KEYS.voteCount(battleId, "A")),
      redis.get(BATTLE_KEYS.voteCount(battleId, "B"))
    ]);
    
    const votesACount = parseInt(votesA) || 0;
    const votesBCount = parseInt(votesB) || 0;
    
    return {
      votesA: votesACount,
      votesB: votesBCount,
      totalVotes: votesACount + votesBCount
    };
    
  } catch (error) {
    console.error(`❌ Get vote counts error: ${battleId}:`, error);
    return { votesA: 0, votesB: 0, totalVotes: 0 };
  }
}

/**
 * Clean up battle data (for completed/expired battles)
 * @param {string} battleId - Battle ID
 * @returns {boolean} - Success status
 */
export async function cleanupBattle(battleId) {
  try {
    const cleanupKey = BATTLE_KEYS.cleanup(battleId);
    
    // Check if already cleaned up
    const alreadyCleaned = await redis.get(cleanupKey);
    if (alreadyCleaned) {
      return true;
    }
    
    // Mark as cleaned up
    await redis.set(cleanupKey, Date.now(), { EX: 60 * 60 * 24 * 7 }); // 7 days
    
    // Clean up vote-related keys (but keep battle data for history)
    const keysToDelete = [
      BATTLE_KEYS.voteCount(battleId, "A"),
      BATTLE_KEYS.voteCount(battleId, "B"),
      BATTLE_KEYS.voters(battleId, "A"),
      BATTLE_KEYS.voters(battleId, "B")
    ];
    
    await Promise.all(keysToDelete.map(key => redis.del(key)));
    
    console.log(`🧹 Battle cleanup completed: ${battleId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Battle cleanup error: ${battleId}:`, error);
    return false;
  }
}
