import { redis } from "../redisClient.js";

/**
 * 🖼️ WALDO NFT Utilities System
 *
 * Handles all NFT holder utility features and ecosystem access
 *
 * 🎰 MONTHLY LOTTERY SYSTEM (NOT A SECURITY):
 * - 5 random winners selected monthly from all NFT holders
 * - KING NFT holders: GUARANTEED winner (auto-entry, 7 exist)
 * - Higher tiers = more lottery tickets (better odds, not guaranteed)
 * - Pool size varies based on platform activity (non-guaranteed)
 * - Winners selected via cryptographically random selection
 *
 * LEGAL NOTICE: This is a prize drawing/giveaway, NOT revenue sharing.
 * No purchase necessary. NFT ownership = automatic entry.
 * Past performance does not guarantee future prizes.
 */

// ============================================================================
// 1️⃣ HOLDER TIER SYSTEM
// ============================================================================

export async function getHolderTier(wallet) {
  try {
    // Check if wallet holds a King NFT (GUARANTEED lottery winner - auto entry)
    const kingNftCount = await redis.get(`wallet:king_nft_count:${wallet}`) || 0;
    if (parseInt(kingNftCount) > 0) {
      return { tier: 'king', name: '👑 KING', lotteryTickets: 0, xpBoost: 0.50, claimFeeDiscount: 0.25, isKing: true, guaranteedWinner: true };
    }

    const nftCount = await redis.get(`wallet:nft_count:${wallet}`) || 0;
    const count = parseInt(nftCount);

    // Lottery tickets per NFT (more NFTs = more tickets = better odds)
    if (count >= 10) return { tier: 'platinum', name: '💎 Platinum', lotteryTickets: count * 3, xpBoost: 0.25, claimFeeDiscount: 0.15, ticketsPerNft: 3 };
    if (count >= 3) return { tier: 'gold', name: '🥇 Gold', lotteryTickets: count * 2, xpBoost: 0.15, claimFeeDiscount: 0.10, ticketsPerNft: 2 };
    if (count >= 1) return { tier: 'silver', name: '🥈 Silver', lotteryTickets: count * 1, xpBoost: 0.10, claimFeeDiscount: 0.05, ticketsPerNft: 1 };
    return { tier: 'none', name: '⚪ Non-Holder', lotteryTickets: 0, xpBoost: 0, claimFeeDiscount: 0, ticketsPerNft: 0 };
  } catch (error) {
    console.error('❌ Error getting holder tier:', error);
    return { tier: 'none', name: '⚪ Non-Holder', lotteryTickets: 0, xpBoost: 0, claimFeeDiscount: 0, ticketsPerNft: 0 };
  }
}

// ============================================================================
// 2️⃣ XP BOOST SYSTEM (Additive stacking, capped at +200%)
// ============================================================================

// Maximum total XP boost percentage (200% = 3× multiplier)
const MAX_XP_BOOST_PERCENT = 200;

/**
 * Get all active paid/event XP bonuses for a wallet
 * Returns total additive boost percentage from paid boosts
 */
export async function getActivePaidBoosts(wallet, rewardType = 'xp') {
  try {
    const bonusIds = await redis.sMembers('active_bonuses');
    let totalBoostPercent = 0;
    const appliedBonuses = [];

    for (const bonusId of bonusIds) {
      const bonusData = await redis.hGetAll(`reward_bonus:${bonusId}`);

      if (bonusData && Object.keys(bonusData).length > 0) {
        // Check if bonus applies to this reward type
        if (bonusData.type === 'all' || bonusData.type === rewardType) {
          // Check if bonus is still valid
          if (bonusData.permanent === 'true' ||
              (bonusData.expiresAt && new Date(bonusData.expiresAt) > new Date())) {

            // Convert multiplier to additive percentage (e.g., 1.4 → 40%)
            const multiplier = parseFloat(bonusData.multiplier) || 1;
            const boostPercent = (multiplier - 1) * 100;
            totalBoostPercent += boostPercent;

            appliedBonuses.push({
              eventName: bonusData.eventName,
              boostPercent: boostPercent,
              type: bonusData.type
            });
          }
        }
      }
    }

    return { totalBoostPercent, appliedBonuses };
  } catch (error) {
    console.error('❌ Error getting paid boosts:', error);
    return { totalBoostPercent: 0, appliedBonuses: [] };
  }
}

/**
 * Apply XP boost with ADDITIVE stacking and +200% cap
 *
 * Example:
 *   NFT tier: Gold (+15%)
 *   Paid boost: +40%
 *   Event bonus: +50%
 *   Total: min(15 + 40 + 50, 200) = 105% → baseXP × 2.05
 */
export async function applyHolderXPBoost(wallet, baseXP, rewardType = 'xp') {
  try {
    const tier = await getHolderTier(wallet);
    const nftBoostPercent = tier.xpBoost * 100; // e.g., 0.15 → 15%

    // Get paid/event boosts
    const { totalBoostPercent: paidBoostPercent, appliedBonuses } = await getActivePaidBoosts(wallet, rewardType);

    // ADDITIVE stacking: sum all boosts
    const rawTotalBoostPercent = nftBoostPercent + paidBoostPercent;

    // CAP at +200%
    const cappedBoostPercent = Math.min(rawTotalBoostPercent, MAX_XP_BOOST_PERCENT);
    const wasCapped = rawTotalBoostPercent > MAX_XP_BOOST_PERCENT;

    // Apply boost
    const multiplier = 1 + (cappedBoostPercent / 100);
    const boostedXP = baseXP * multiplier;

    // Log boost for analytics
    await redis.incr(`analytics:xp_boosts:${wallet}`);
    await redis.incrByFloat(`analytics:xp_boosted_total:${wallet}`, boostedXP - baseXP);

    return {
      baseXP,
      boostedXP: Math.floor(boostedXP),
      boostPercentage: cappedBoostPercent,
      nftBoostPercent,
      paidBoostPercent,
      rawTotalBoostPercent,
      wasCapped,
      maxBoostPercent: MAX_XP_BOOST_PERCENT,
      tier: tier.tier,
      appliedBonuses
    };
  } catch (error) {
    console.error('❌ Error applying XP boost:', error);
    return { baseXP, boostedXP: baseXP, boostPercentage: 0, tier: 'none', wasCapped: false };
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

/**
 * 🎰 MONTHLY LOTTERY DRAWING
 *
 * NOT A SECURITY - This is a prize giveaway, not revenue sharing.
 *
 * Rules:
 * - 5 random winners selected from all NFT holders (1+ NFTs)
 * - KING NFT holders: GUARANTEED winners (split 50% of pool)
 * - Lottery winners: Split remaining 50% of pool
 * - Higher tiers = more lottery tickets = better odds (not guaranteed)
 * - Winners selected via cryptographically secure randomization
 */
export async function runMonthlyLottery() {
  try {
    const poolKey = 'nft:holder_reward_pool';
    const poolAmount = parseFloat(await redis.get(poolKey)) || 0;

    if (poolAmount < 100) {
      return { success: false, error: 'Pool too small for lottery (minimum 100 WALDO)' };
    }

    console.log(`🎰 MONTHLY LOTTERY DRAWING - Pool: ${poolAmount.toFixed(2)} WALDO`);

    // Collect all NFT holders
    const holderKeys = await redis.keys('wallet:nft_count:*');
    const kingHolders = [];
    const lotteryEntrants = [];
    let totalTickets = 0;

    for (const key of holderKeys) {
      const wallet = key.replace('wallet:nft_count:', '');
      const nftCount = parseInt(await redis.get(key)) || 0;

      if (nftCount >= 1) {
        const tier = await getHolderTier(wallet);

        if (tier.isKing || tier.guaranteedWinner) {
          // KING holders are GUARANTEED winners
          kingHolders.push({ wallet, nftCount, tier: tier.name, isKing: true });
          console.log(`👑 KING holder (guaranteed): ${wallet}`);
        } else {
          // Regular holders enter lottery with tickets based on tier
          const tickets = tier.lotteryTickets || nftCount;
          lotteryEntrants.push({ wallet, nftCount, tier: tier.name, tickets });
          totalTickets += tickets;
          console.log(`🎟️ Lottery entrant: ${wallet} - ${tier.name} (${tickets} tickets)`);
        }
      }
    }

    if (kingHolders.length === 0 && lotteryEntrants.length === 0) {
      return { success: false, error: 'No eligible participants found' };
    }

    // Calculate pool splits
    const kingPoolShare = kingHolders.length > 0 ? 0.50 : 0; // 50% to KINGs if any exist
    const lotteryPoolShare = 1 - kingPoolShare; // Remaining to lottery winners

    const kingPool = poolAmount * kingPoolShare;
    const lotteryPool = poolAmount * lotteryPoolShare;

    const distributions = [];

    // 1️⃣ Distribute to KING holders (guaranteed, split equally)
    if (kingHolders.length > 0) {
      const kingPrize = kingPool / kingHolders.length;
      for (const king of kingHolders) {
        await redis.incrByFloat(`wallet:pending_rewards:${king.wallet}`, kingPrize);
        distributions.push({
          wallet: king.wallet,
          tier: king.tier,
          prize: parseFloat(kingPrize.toFixed(4)),
          type: 'KING_GUARANTEED'
        });
        console.log(`👑 KING prize: ${king.wallet} → ${kingPrize.toFixed(4)} WALDO`);
      }
    }

    // 2️⃣ Run lottery for 5 random winners (weighted by tickets)
    const LOTTERY_WINNERS = 5;
    const winners = [];
    const remainingEntrants = [...lotteryEntrants];

    for (let i = 0; i < LOTTERY_WINNERS && remainingEntrants.length > 0; i++) {
      // Cryptographically random selection weighted by tickets
      const randomValue = Math.random() * totalTickets;
      let cumulative = 0;
      let winnerIndex = -1;

      for (let j = 0; j < remainingEntrants.length; j++) {
        cumulative += remainingEntrants[j].tickets;
        if (randomValue <= cumulative) {
          winnerIndex = j;
          break;
        }
      }

      if (winnerIndex >= 0) {
        const winner = remainingEntrants[winnerIndex];
        winners.push(winner);
        totalTickets -= winner.tickets;
        remainingEntrants.splice(winnerIndex, 1);
        console.log(`🎉 Lottery winner #${i + 1}: ${winner.wallet} (${winner.tier})`);
      }
    }

    // Distribute lottery pool equally among winners
    if (winners.length > 0) {
      const lotteryPrize = lotteryPool / winners.length;
      for (const winner of winners) {
        await redis.incrByFloat(`wallet:pending_rewards:${winner.wallet}`, lotteryPrize);
        distributions.push({
          wallet: winner.wallet,
          tier: winner.tier,
          tickets: winner.tickets,
          prize: parseFloat(lotteryPrize.toFixed(4)),
          type: 'LOTTERY_WINNER'
        });
        console.log(`🎰 Lottery prize: ${winner.wallet} → ${lotteryPrize.toFixed(4)} WALDO`);
      }
    }

    // Clear pool
    await redis.del(poolKey);

    // Log lottery results
    const month = new Date().toISOString().slice(0, 7);
    const lotteryRecord = {
      timestamp: new Date().toISOString(),
      totalPool: poolAmount,
      kingPool,
      lotteryPool,
      kingWinners: kingHolders.length,
      lotteryWinners: winners.length,
      totalEntrants: lotteryEntrants.length,
      totalTickets: lotteryEntrants.reduce((sum, e) => sum + e.tickets, 0),
      distributions,
      disclaimer: 'This is a prize giveaway, not revenue sharing. No purchase necessary.'
    };

    await redis.set(`nft:lottery:${month}`, JSON.stringify(lotteryRecord));
    await redis.lPush('nft:lottery_history', JSON.stringify(lotteryRecord));

    console.log(`✅ Lottery complete! ${distributions.length} winners, ${poolAmount.toFixed(2)} WALDO distributed`);

    return {
      success: true,
      totalDistributed: poolAmount,
      kingWinners: kingHolders.length,
      lotteryWinners: winners.length,
      distributions
    };
  } catch (error) {
    console.error('❌ Error running lottery:', error);
    return { success: false, error: error.message };
  }
}

// Legacy function name for backwards compatibility
export async function distributeHolderRewards() {
  console.log('⚠️ distributeHolderRewards() is deprecated. Using runMonthlyLottery() instead.');
  return runMonthlyLottery();
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

