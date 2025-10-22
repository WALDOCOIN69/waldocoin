import { redis } from '../redisClient.js';
import dayjs from 'dayjs';

/**
 * DAO Data Migration and Cleanup Utility
 * Fixes inconsistencies between old and new DAO systems
 */

export async function migrateDAOData() {
  console.log('🔄 Starting DAO data migration...');
  
  try {
    // 1. Find all legacy proposals and migrate to new format
    await migrateLegacyProposals();
    
    // 2. Consolidate vote data
    await consolidateVoteData();
    
    // 3. Standardize status values
    await standardizeStatusValues();
    
    // 4. Clean up duplicate keys
    await cleanupDuplicateKeys();
    
    console.log('✅ DAO data migration completed successfully!');
    return { success: true, message: 'Migration completed' };
    
  } catch (error) {
    console.error('❌ DAO data migration failed:', error);
    return { success: false, error: error.message };
  }
}

async function migrateLegacyProposals() {
  console.log('📋 Migrating legacy proposals...');
  
  // Find old proposal keys (proposal:*)
  const oldKeys = await redis.keys('proposal:*');
  let migrated = 0;
  
  for (const oldKey of oldKeys) {
    try {
      const proposalId = oldKey.replace('proposal:', '');
      const newKey = `dao:proposal:${proposalId}`;
      
      // Check if new key already exists
      const exists = await redis.exists(newKey);
      if (exists) {
        console.log(`⚠️ Skipping ${proposalId} - already exists in new format`);
        continue;
      }
      
      // Get old data
      const oldData = await redis.hGetAll(oldKey);
      if (!oldData || Object.keys(oldData).length === 0) continue;
      
      // Transform to new format
      const newData = {
        ...oldData,
        // Standardize status values
        status: standardizeStatus(oldData.status),
        // Add missing fields with defaults
        tier: oldData.tier || 'COMMUNITY',
        category: oldData.category || 'GENERAL',
        proposer: oldData.proposer || 'legacy',
        quorum: oldData.quorum || 1000,
        threshold: oldData.threshold || 0.60,
        // Ensure dates are ISO strings
        createdAt: oldData.createdAt || new Date().toISOString(),
        votingEndsAt: oldData.expiresAt || oldData.votingEndsAt || dayjs().add(7, 'days').toISOString()
      };
      
      // Store in new format
      await redis.hSet(newKey, newData);
      
      // Initialize vote counters if they don't exist
      const yesKey = `dao:proposal:${proposalId}:yes`;
      const noKey = `dao:proposal:${proposalId}:no`;
      
      if (!(await redis.exists(yesKey))) {
        await redis.set(yesKey, 0);
      }
      if (!(await redis.exists(noKey))) {
        await redis.set(noKey, 0);
      }
      
      // Add to active proposals list if active
      if (newData.status === 'ACTIVE') {
        await redis.lPush('dao:active_proposals', proposalId);
      }
      
      migrated++;
      console.log(`✅ Migrated proposal ${proposalId}`);
      
    } catch (error) {
      console.error(`❌ Failed to migrate ${oldKey}:`, error);
    }
  }
  
  console.log(`📋 Migrated ${migrated} legacy proposals`);
}

async function consolidateVoteData() {
  console.log('🗳️ Consolidating vote data...');
  
  // Find all legacy vote keys (proposalVotes:*)
  const voteKeys = await redis.keys('proposalVotes:*');
  let consolidated = 0;
  
  for (const voteKey of voteKeys) {
    try {
      const proposalId = voteKey.replace('proposalVotes:', '');
      const votes = await redis.hGetAll(voteKey);
      
      if (!votes || Object.keys(votes).length === 0) continue;
      
      // Count votes and update counters
      let yesCount = 0;
      let noCount = 0;
      
      for (const [wallet, voteData] of Object.entries(votes)) {
        try {
          const vote = typeof voteData === 'string' ? JSON.parse(voteData) : voteData;
          const choice = vote.choice || voteData; // Handle both formats
          
          if (choice === 'yes' || choice === true) {
            yesCount += vote.votingPower || 1;
          } else if (choice === 'no' || choice === false) {
            noCount += vote.votingPower || 1;
          }
          
          // Create individual vote record in new format
          const newVoteKey = `dao:vote:${proposalId}:${wallet}`;
          await redis.set(newVoteKey, JSON.stringify({
            vote: choice === 'yes' || choice === true,
            votingPower: vote.votingPower || 1,
            waldoBalance: vote.waldoBalance || 0,
            timestamp: vote.timestamp || new Date().toISOString()
          }));
          
        } catch (parseError) {
          // Handle simple string votes
          if (voteData === 'yes' || voteData === true) yesCount++;
          else if (voteData === 'no' || voteData === false) noCount++;
        }
      }
      
      // Update vote counters
      await redis.set(`dao:proposal:${proposalId}:yes`, yesCount);
      await redis.set(`dao:proposal:${proposalId}:no`, noCount);
      
      consolidated++;
      console.log(`✅ Consolidated votes for proposal ${proposalId}: ${yesCount} yes, ${noCount} no`);
      
    } catch (error) {
      console.error(`❌ Failed to consolidate votes for ${voteKey}:`, error);
    }
  }
  
  console.log(`🗳️ Consolidated ${consolidated} vote records`);
}

async function standardizeStatusValues() {
  console.log('📊 Standardizing status values...');
  
  const proposalKeys = await redis.keys('dao:proposal:*');
  let standardized = 0;
  
  for (const key of proposalKeys) {
    try {
      const data = await redis.hGetAll(key);
      if (!data || !data.status) continue;
      
      const newStatus = standardizeStatus(data.status);
      if (newStatus !== data.status) {
        await redis.hSet(key, 'status', newStatus);
        standardized++;
        console.log(`✅ Standardized status for ${key}: ${data.status} → ${newStatus}`);
      }
    } catch (error) {
      console.error(`❌ Failed to standardize status for ${key}:`, error);
    }
  }
  
  console.log(`📊 Standardized ${standardized} status values`);
}

function standardizeStatus(status) {
  if (!status) return 'ACTIVE';
  
  const statusMap = {
    'active': 'ACTIVE',
    'expired': 'EXPIRED',
    'archived': 'ARCHIVED',
    'passed': 'PASSED',
    'failed': 'FAILED',
    'closed': 'CLOSED'
  };
  
  return statusMap[status.toLowerCase()] || status.toUpperCase();
}

async function cleanupDuplicateKeys() {
  console.log('🧹 Cleaning up duplicate keys...');
  
  // Remove any orphaned keys or duplicates
  const allKeys = await redis.keys('*dao*');
  const duplicates = [];
  
  for (const key of allKeys) {
    // Check for malformed keys
    if (key.includes('::') || key.endsWith(':')) {
      duplicates.push(key);
    }
  }
  
  if (duplicates.length > 0) {
    console.log(`🗑️ Found ${duplicates.length} malformed keys to clean up`);
    for (const key of duplicates) {
      await redis.del(key);
      console.log(`🗑️ Deleted malformed key: ${key}`);
    }
  }
  
  console.log('🧹 Cleanup completed');
}

// Export individual functions for testing
export {
  migrateLegacyProposals,
  consolidateVoteData,
  standardizeStatusValues,
  cleanupDuplicateKeys
};
