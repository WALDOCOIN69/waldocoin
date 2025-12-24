/**
 * Test script to check NFT holder detection for lottery
 */

import { redis } from './redisClient.js';
import { getHolderTier } from './utils/nftUtilities.js';

async function testNFTDetection() {
  try {
    console.log('🔍 Testing NFT Holder Detection for Lottery System\n');
    console.log('='.repeat(60));
    
    // Check for NFT count keys
    const nftCountKeys = await redis.keys('wallet:nft_count:*');
    console.log('\n📊 NFT Count Keys Found:', nftCountKeys.length);
    
    if (nftCountKeys.length === 0) {
      console.log('\n⚠️  NO NFT HOLDERS FOUND IN REDIS!');
      console.log('   This means either:');
      console.log('   1. No one has bought NFTs yet');
      console.log('   2. NFT purchases are not being tracked in Redis');
      console.log('   3. The key pattern is different\n');
      
      // Check for alternative patterns
      const altPatterns = [
        'nft:*',
        '*:nft:*',
        'holder:*',
        '*wallet*nft*'
      ];
      
      for (const pattern of altPatterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          console.log(`   Found ${keys.length} keys matching "${pattern}":`);
          keys.slice(0, 5).forEach(k => console.log(`     - ${k}`));
        }
      }
    } else {
      // Show all holders with tier info
      console.log('\n👥 NFT Holders:\n');
      
      let kingHolders = [];
      let platinumHolders = [];
      let goldHolders = [];
      let silverHolders = [];
      
      for (const key of nftCountKeys) {
        const wallet = key.replace('wallet:nft_count:', '');
        const count = parseInt(await redis.get(key)) || 0;
        const tier = await getHolderTier(wallet);
        
        const holderInfo = {
          wallet: wallet.slice(0, 12) + '...' + wallet.slice(-6),
          fullWallet: wallet,
          count,
          tier: tier.name,
          tickets: tier.lotteryTickets || count
        };
        
        if (tier.isKing || tier.guaranteedWinner) {
          kingHolders.push(holderInfo);
        } else if (tier.tier === 'platinum') {
          platinumHolders.push(holderInfo);
        } else if (tier.tier === 'gold') {
          goldHolders.push(holderInfo);
        } else if (tier.tier === 'silver') {
          silverHolders.push(holderInfo);
        }
      }
      
      // Display by tier
      if (kingHolders.length > 0) {
        console.log('👑 KING HOLDERS (GUARANTEED WINNERS):');
        kingHolders.forEach(h => console.log(`   ${h.wallet} | ${h.count} NFTs | ✅ AUTO-WIN`));
        console.log();
      }
      
      if (platinumHolders.length > 0) {
        console.log('💎 PLATINUM HOLDERS (3 tickets/NFT):');
        platinumHolders.forEach(h => console.log(`   ${h.wallet} | ${h.count} NFTs | ${h.tickets} tickets`));
        console.log();
      }
      
      if (goldHolders.length > 0) {
        console.log('🥇 GOLD HOLDERS (2 tickets/NFT):');
        goldHolders.forEach(h => console.log(`   ${h.wallet} | ${h.count} NFTs | ${h.tickets} tickets`));
        console.log();
      }
      
      if (silverHolders.length > 0) {
        console.log('🥈 SILVER HOLDERS (1 ticket/NFT):');
        silverHolders.forEach(h => console.log(`   ${h.wallet} | ${h.count} NFTs | ${h.tickets} tickets`));
        console.log();
      }
      
      const totalTickets = [...platinumHolders, ...goldHolders, ...silverHolders]
        .reduce((sum, h) => sum + h.tickets, 0);
      
      console.log('='.repeat(60));
      console.log('📊 SUMMARY:');
      console.log(`   👑 KING holders: ${kingHolders.length} (guaranteed winners)`);
      console.log(`   💎 Platinum: ${platinumHolders.length}`);
      console.log(`   🥇 Gold: ${goldHolders.length}`);
      console.log(`   🥈 Silver: ${silverHolders.length}`);
      console.log(`   🎟️  Total lottery tickets: ${totalTickets}`);
    }
    
    // Check KING NFT specific keys
    const kingKeys = await redis.keys('wallet:king_nft_count:*');
    console.log('\n👑 KING NFT Specific Keys:', kingKeys.length);
    for (const key of kingKeys) {
      const wallet = key.replace('wallet:king_nft_count:', '');
      const count = await redis.get(key);
      if (parseInt(count) > 0) {
        console.log(`   ${wallet.slice(0,12)}...${wallet.slice(-6)}: ${count} KING NFTs`);
      }
    }
    
    // Check lottery pool
    const pool = await redis.get('nft:holder_reward_pool');
    console.log('\n💰 Current Lottery Pool:', pool || '0', 'WALDO');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test complete!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testNFTDetection();

