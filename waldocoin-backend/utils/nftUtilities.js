import { redis } from "../redisClient.js";

/**
 * 🖼️ WALDO NFT Utilities System
 * 
 * Handles all NFT holder benefits, rewards, and utility features
 */

// ============================================================================
// 1️⃣ HOLDER TIER SYSTEM
// ============================================================================

export async function getHolderTier(wallet) {
  try {
    const nftCount = await redis.get(`wallet:nft_count:${wallet}`) || 0;
    const count = parseInt(nftCount);

    if (count >= 10) return { tier: 'platinum', name: '👑 Platinum', shares: 5, xpBoost: 0.25, claimFeeDiscount: 0.15 };
    if (count >= 3) return { tier: 'gold', name: '🥇 Gold', shares: 2, xpBoost: 0.15, claimFeeDiscount: 0.10 };
    if (count >= 1) return { tier: 'silver', name: '🥈 Silver', shares: 1, xpBoost: 0.10, claimFeeDiscount: 0.05 };
    return { tier: 'none', name: '⚪ Non-Holder', shares: 0, xpBoost: 0, claimFeeDiscount: 0 };
  } catch (error) {
    console.error('❌ Error getting holder tier:', error);
    return { tier: 'none', name: '⚪ Non-Holder', shares: 0, xpBoost: 0, claimFeeDiscount: 0 };
  }
}

// ============================================================================
// 2️⃣ XP BOOST SYSTEM
// ============================================================================

export async function applyHolderXPBoost(wallet, baseXP) {
  try {
    const tier = await getHolderTier(wallet);
    const boostedXP = baseXP * (1 + tier.xpBoost);
    
    // Log boost for analytics
    await redis.incr(`analytics:xp_boosts:${wallet}`);
    await redis.incrByFloat(`analytics:xp_boosted_total:${wallet}`, boostedXP - baseXP);
    
    return {
      baseXP,
      boostedXP: Math.floor(boostedXP),
      boostPercentage: tier.xpBoost * 100,
      tier: tier.tier
    };
  } catch (error) {
    console.error('❌ Error applying XP boost:', error);
    return { baseXP, boostedXP: baseXP, boostPercentage: 0, tier: 'none' };
  }
}

// ============================================================================
// 3️⃣ CLAIM FEE DISCOUNT SYSTEM
// ============================================================================

export async function applyClaimFeeDiscount(wallet, baseFee) {
  try {
    const tier = await getHolderTier(wallet);
    const discountedFee = baseFee * (1 - tier.claimFeeDiscount);
    
    return {
      baseFee,
      discountedFee: parseFloat(discountedFee.toFixed(4)),
      discountPercentage: tier.claimFeeDiscount * 100,
      tier: tier.tier
  };
  } catch (error) {
    console.error('❌ Error applying fee discount:', error);
    return { baseFee, discountedFee: baseFee, discountPercentage: 0, tier: 'none' };
  }
}

// ============================================================================
// 4️⃣ HOLDER REWARD POOL SYSTEM
// ============================================================================

export async function addToHolderRewardPool(amount) {
  try {
    const poolKey = 'nft:holder_reward_pool';
    await redis.incrByFloat(poolKey, amount);
    
    // Track monthly pools
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    await redis.incrByFloat(`nft:holder_reward_pool:${month}`, amount);
    
    console.log(`💰 Added ${amount} WALDO to holder reward pool`);
    return { success: true, poolAmount: await redis.get(poolKey) };
  } catch (error) {
    console.error('❌ Error adding to reward pool:', error);
    return { success: false, error: error.message };
  }
}

export async function distributeHolderRewards() {
  try {
    const poolKey = 'nft:holder_reward_pool';
    const poolAmount = parseFloat(await redis.get(poolKey)) || 0;
    
    if (poolAmount <= 0) {
      return { success: false, error: 'No rewards to distribute' };
    }

    // Get all NFT holders
    const holderKeys = await redis.keys('wallet:nft_count:*');
    const holders = [];

    for (const key of holderKeys) {
      const wallet = key.replace('wallet:nft_count:', '');
      const nftCount = parseInt(await redis.get(key)) || 0;
      if (nftCount > 0) {
        const tier = await getHolderTier(wallet);
        holders.push({ wallet, nftCount, shares: tier.shares });
      }
    }

    // Calculate total shares
    const totalShares = holders.reduce((sum, h) => sum + h.shares, 0);
    if (totalShares === 0) return { success: false, error: 'No holders found' };

    // Distribute rewards pro-rata
    const distributions = [];
    for (const holder of holders) {
      const reward = (holder.shares / totalShares) * poolAmount;
      await redis.incrByFloat(`wallet:pending_rewards:${holder.wallet}`, reward);
      distributions.push({ wallet: holder.wallet, reward: parseFloat(reward.toFixed(4)) });
    }

    // Clear pool
    await redis.del(poolKey);
    
    // Log distribution
    const month = new Date().toISOString().slice(0, 7);
    await redis.set(`nft:last_distribution:${month}`, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalDistributed: poolAmount,
      holders: distributions.length,
      distributions
    }));

    return { success: true, totalDistributed: poolAmount, holders: distributions.length };
  } catch (error) {
    console.error('❌ Error distributing rewards:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 5️⃣ BATTLE ACCESS CONTROL
// ============================================================================

export async function canAccessHolderBattle(wallet) {
  try {
    const tier = await getHolderTier(wallet);
    return tier.tier !== 'none';
  } catch (error) {
    console.error('❌ Error checking battle access:', error);
    return false;
  }
}

export async function getHolderBattleDiscount(wallet) {
  try {
    const tier = await getHolderTier(wallet);
    
    // Discount based on tier
    const discounts = {
      platinum: 0.30, // 30% off
      gold: 0.20,     // 20% off
      silver: 0.10,   // 10% off
      none: 0
    };
    
    return discounts[tier.tier] || 0;
  } catch (error) {
    console.error('❌ Error getting battle discount:', error);
    return 0;
  }
}

// ============================================================================
// 6️⃣ STAKING BOOST SYSTEM
// ============================================================================

export async function getStakingBoost(wallet) {
  try {
    const tier = await getHolderTier(wallet);
    
    // APY boost based on tier
    const boosts = {
      platinum: 0.05,  // +5% APY
      gold: 0.03,      // +3% APY
      silver: 0.01,    // +1% APY
      none: 0
    };
    
    return boosts[tier.tier] || 0;
  } catch (error) {
    console.error('❌ Error getting staking boost:', error);
    return 0;
  }
}

// ============================================================================
// 7️⃣ LEADERBOARD SYSTEM
// ============================================================================

export async function getTopNFTHolders(limit = 10) {
  try {
    const holderKeys = await redis.keys('wallet:nft_count:*');
    const holders = [];

    for (const key of holderKeys) {
      const wallet = key.replace('wallet:nft_count:', '');
      const nftCount = parseInt(await redis.get(key)) || 0;
      if (nftCount > 0) {
        const tier = await getHolderTier(wallet);
        holders.push({
          wallet: wallet.substring(0, 10) + '...' + wallet.substring(wallet.length - 6),
          nftCount,
          tier: tier.name,
          shares: tier.shares
        });
      }
    }

    // Sort by NFT count descending
    return holders.sort((a, b) => b.nftCount - a.nftCount).slice(0, limit);
  } catch (error) {
    console.error('❌ Error getting leaderboard:', error);
    return [];
  }
}

// ============================================================================
// 8️⃣ DAO VOTING POWER
// ============================================================================

export async function getNFTVotingPower(wallet) {
  try {
    const tier = await getHolderTier(wallet);
    
    // Voting power multiplier
    const multipliers = {
      platinum: 1.5,  // 1.5× voting power
      gold: 1.25,     // 1.25× voting power
      silver: 1.1,    // 1.1× voting power
      none: 1.0
    };
    
    return multipliers[tier.tier] || 1.0;
  } catch (error) {
    console.error('❌ Error getting voting power:', error);
    return 1.0;
  }
}

// ============================================================================
// 9️⃣ MONTHLY PERKS SYSTEM
// ============================================================================

export async function getMonthlyPerks(wallet) {
  try {
    const tier = await getHolderTier(wallet);
    const month = new Date().toISOString().slice(0, 7);
    
    const perks = {
      platinum: [
        '🎁 50% off minting fees',
        '⚡ Early access to new features',
        '🏆 VIP leaderboard status',
        '💎 Exclusive Discord role',
        '🎟️ Free battle entries (3/month)'
      ],
      gold: [
        '🎁 30% off minting fees',
        '⚡ Early access to features',
        '🏆 Leaderboard eligibility',
        '💎 Gold Discord role',
        '🎟️ Discounted battle entries'
      ],
      silver: [
        '🎁 15% off minting fees',
        '💎 Silver Discord role',
        '🎟️ 10% battle fee discount'
      ],
      none: []
    };
    
    // Check if perks already claimed this month
    const claimedKey = `wallet:perks_claimed:${wallet}:${month}`;
    const alreadyClaimed = await redis.get(claimedKey);
    
    return {
      tier: tier.name,
      perks: perks[tier.tier] || [],
      claimed: !!alreadyClaimed,
      month
    };
  } catch (error) {
    console.error('❌ Error getting monthly perks:', error);
    return { tier: '⚪ Non-Holder', perks: [], claimed: false };
  }
}

export async function claimMonthlyPerks(wallet) {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const claimedKey = `wallet:perks_claimed:${wallet}:${month}`;
    
    const alreadyClaimed = await redis.get(claimedKey);
    if (alreadyClaimed) {
      return { success: false, error: 'Perks already claimed this month' };
    }
    
    const perks = await getMonthlyPerks(wallet);
    await redis.set(claimedKey, '1', { EX: 2592000 }); // 30 days
    
    return { success: true, perks: perks.perks };
  } catch (error) {
    console.error('❌ Error claiming perks:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 🔟 UTILITY TRACKING
// ============================================================================

export async function trackNFTUtilityUsage(wallet, utilityType) {
  try {
    const key = `analytics:nft_utility:${wallet}:${utilityType}`;
    await redis.incr(key);
    await redis.expire(key, 2592000); // 30 days
    return { success: true };
  } catch (error) {
    console.error('❌ Error tracking utility usage:', error);
    return { success: false };
  }
}

export default {
  getHolderTier,
  applyHolderXPBoost,
  applyClaimFeeDiscount,
  addToHolderRewardPool,
  distributeHolderRewards,
  canAccessHolderBattle,
  getHolderBattleDiscount,
  getStakingBoost,
  getTopNFTHolders,
  getNFTVotingPower,
  getMonthlyPerks,
  claimMonthlyPerks,
  trackNFTUtilityUsage
};

