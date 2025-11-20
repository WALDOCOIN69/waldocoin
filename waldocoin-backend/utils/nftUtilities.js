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
    // Check if wallet holds a King NFT (automatic VIP tier)
    const kingNftCount = await redis.get(`wallet:king_nft_count:${wallet}`) || 0;
    if (parseInt(kingNftCount) > 0) {
      return { tier: 'king', name: '👑 KING', shares: 10, xpBoost: 0.50, claimFeeDiscount: 0.25, isKing: true };
    }

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

    // Get all NFT holders with 3+ NFTs (Gold tier and above only)
    const holderKeys = await redis.keys('wallet:nft_count:*');
    const holders = [];

    for (const key of holderKeys) {
      const wallet = key.replace('wallet:nft_count:', '');
      const nftCount = parseInt(await redis.get(key)) || 0;

      // ONLY include holders with 3+ NFTs (Gold, Platinum, KING tiers)
      // Silver tier (1-2 NFTs) is excluded from revenue sharing
      if (nftCount >= 3) {
        const tier = await getHolderTier(wallet);
        holders.push({ wallet, nftCount, tier: tier.name, shares: tier.shares });
        console.log(`💎 Eligible holder: ${wallet} - ${tier.name} (${nftCount} NFTs, ${tier.shares} shares)`);
      }
    }

    // Calculate total shares
    const totalShares = holders.reduce((sum, h) => sum + h.shares, 0);
    if (totalShares === 0) return { success: false, error: 'No eligible holders found (3+ NFTs required)' };

    console.log(`💰 Distributing ${poolAmount.toFixed(2)} WALDO to ${holders.length} holders (total shares: ${totalShares})`);

    // Distribute rewards pro-rata
    const distributions = [];
    for (const holder of holders) {
      const reward = (holder.shares / totalShares) * poolAmount;
      await redis.incrByFloat(`wallet:pending_rewards:${holder.wallet}`, reward);
      distributions.push({
        wallet: holder.wallet,
        tier: holder.tier,
        nftCount: holder.nftCount,
        shares: holder.shares,
        reward: parseFloat(reward.toFixed(4))
      });
      console.log(`  → ${holder.wallet}: ${reward.toFixed(4)} WALDO (${holder.tier}, ${holder.shares} shares)`);
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
      king: 0.50,     // 50% off (King NFT)
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
      king: 0.15,      // +15% APY (King NFT)
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
      king: 3.0,      // 3.0× voting power (King NFT)
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
      king: [
        '👑 KING Status (Limited to 7)',
        '🎁 100% off minting fees (FREE)',
        '⚡ Unlimited early access to all features',
        '🏆 Hall of Fame leaderboard status',
        '💎 Exclusive KING Discord role',
        '💰 50% battle entry discount',
        '💰 50% off all marketplace fees',
        '🌟 Special KING badge on profile',
        '🎁 Monthly revenue share (10× shares)',
        '🔮 Voting power: 3.0× multiplier'
      ],
      platinum: [
        '🎁 50% off minting fees',
        '⚡ Early access to new features',
        '🏆 VIP leaderboard status',
        '💎 Exclusive Discord role',
        '💰 30% battle entry discount',
        '🎁 Monthly revenue share (5× shares)'
      ],
      gold: [
        '🎁 30% off minting fees',
        '⚡ Early access to features',
        '🏆 Leaderboard eligibility',
        '💰 20% battle entry discount',
        '🎁 Monthly revenue share (2× shares)',
        '💎 Gold Discord role',
        '🎟️ 20% off voting fees (160 WALDO per vote)'
      ],
      silver: [
        '🎁 15% off minting fees',
        '💎 Silver Discord role',
        '🎟️ 10% off voting fees (180 WALDO per vote)'
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

// ============================================================================
// 9️⃣ KING NFT SYSTEM (Limited to 5)
// ============================================================================

export async function assignKingNFT(wallet, nftId) {
  try {
    // Check current King count (maximum 7 King NFTs in collection)
    const kingCount = await redis.get('system:king_nft_count') || 0;
    if (parseInt(kingCount) >= 7) {
      return { success: false, error: 'Maximum 7 King NFTs already assigned' };
    }

    // Assign King NFT to wallet
    await redis.set(`wallet:king_nft:${wallet}`, nftId);
    await redis.incr(`wallet:king_nft_count:${wallet}`);
    await redis.incr('system:king_nft_count');

    // Track King NFT
    await redis.sAdd('system:king_nfts', `${wallet}:${nftId}`);

    console.log(`👑 King NFT assigned to ${wallet}: ${nftId}`);
    return { success: true, message: 'King NFT assigned' };
  } catch (error) {
    console.error('❌ Error assigning King NFT:', error);
    return { success: false, error: error.message };
  }
}

export async function revokeKingNFT(wallet) {
  try {
    const nftId = await redis.get(`wallet:king_nft:${wallet}`);
    if (!nftId) {
      return { success: false, error: 'Wallet does not hold a King NFT' };
    }

    // Revoke King NFT
    await redis.del(`wallet:king_nft:${wallet}`);
    await redis.decr(`wallet:king_nft_count:${wallet}`);
    await redis.decr('system:king_nft_count');
    await redis.sRem('system:king_nfts', `${wallet}:${nftId}`);

    console.log(`👑 King NFT revoked from ${wallet}`);
    return { success: true, message: 'King NFT revoked' };
  } catch (error) {
    console.error('❌ Error revoking King NFT:', error);
    return { success: false, error: error.message };
  }
}

export async function getKingNFTHolders() {
  try {
    const kingNfts = await redis.sMembers('system:king_nfts');
    const holders = [];

    for (const entry of kingNfts) {
      const [wallet, nftId] = entry.split(':');
      holders.push({
        wallet: wallet.substring(0, 10) + '...' + wallet.substring(wallet.length - 6),
        nftId,
        fullWallet: wallet
      });
    }

    return holders;
  } catch (error) {
    console.error('❌ Error getting King NFT holders:', error);
    return [];
  }
}

export async function isKingNFTHolder(wallet) {
  try {
    const kingNftCount = await redis.get(`wallet:king_nft_count:${wallet}`) || 0;
    return parseInt(kingNftCount) > 0;
  } catch (error) {
    console.error('❌ Error checking King NFT status:', error);
    return false;
  }
}

// ============================================================================
// VOTING DISCOUNT SYSTEM
// ============================================================================

// ============================================================================
// 🗳️ VOTING DISCOUNT SYSTEM (NO FREE VOTES - maintains battle prize pool)
// ============================================================================

export async function getVotingDiscount(wallet) {
  try {
    const tier = await getHolderTier(wallet);

    // Voting discounts - NO FREE VOTES to maintain prize pool integrity
    // All votes cost WALDO, but NFT holders get discounts
    const discounts = {
      king: 0.0,      // No discount (KING gets battle entry discount instead)
      platinum: 0.0,  // No discount (Platinum gets battle entry discount instead)
      gold: 0.0,      // No discount (Gold gets battle entry discount instead)
      silver: 0.0,    // No discount
      none: 0
    };

    return discounts[tier.tier] || 0;
  } catch (error) {
    console.error('❌ Error getting voting discount:', error);
    return 0;
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
  trackNFTUtilityUsage,
  assignKingNFT,
  revokeKingNFT,
  getKingNFTHolders,
  isKingNFTHolder,
  getVotingDiscount
};

