/**
 * Test script to check NFT holder detection for lottery
 */

import {
  scanXRPLForNFTHolders,
  getNFTHolders,
  getLotteryStatus,
  addToLotteryPool
} from './utils/xrplNFTScanner.js';
import dotenv from 'dotenv';

dotenv.config();

async function testNFTDetection() {
  try {
    console.log('🔍 Testing XRPL NFT Scanner for Lottery System\n');
    console.log('='.repeat(60));

    // Scan XRPL for NFT holders
    console.log('\n📡 Scanning XRPL blockchain for WALDO NFT holders...\n');
    const holders = await scanXRPLForNFTHolders();

    console.log('\n' + '='.repeat(60));
    console.log('📊 SCAN RESULTS:\n');

    if (holders.length === 0) {
      console.log('⚠️  NO NFT HOLDERS FOUND!');
    } else {
      // Group by tier
      const kingHolders = holders.filter(h => h.hasKingNFT);
      const platinumHolders = holders.filter(h => h.tier === 'Platinum' && !h.hasKingNFT);
      const goldHolders = holders.filter(h => h.tier === 'Gold' && !h.hasKingNFT);
      const silverHolders = holders.filter(h => h.tier === 'Silver' && !h.hasKingNFT);

      if (kingHolders.length > 0) {
        console.log('👑 KING HOLDERS (5 tickets/NFT - Best Odds):');
        kingHolders.forEach(h => console.log(`   ${h.wallet.slice(0,12)}...${h.wallet.slice(-6)} | ${h.nftCount} NFTs | ${h.totalTickets} tickets`));
        console.log();
      }

      if (platinumHolders.length > 0) {
        console.log('💎 PLATINUM HOLDERS (3 tickets/NFT):');
        platinumHolders.forEach(h => console.log(`   ${h.wallet.slice(0,12)}...${h.wallet.slice(-6)} | ${h.nftCount} NFTs | ${h.totalTickets} tickets`));
        console.log();
      }

      if (goldHolders.length > 0) {
        console.log('🥇 GOLD HOLDERS (2 tickets/NFT):');
        goldHolders.forEach(h => console.log(`   ${h.wallet.slice(0,12)}...${h.wallet.slice(-6)} | ${h.nftCount} NFTs | ${h.totalTickets} tickets`));
        console.log();
      }

      if (silverHolders.length > 0) {
        console.log('🥈 SILVER HOLDERS (1 ticket/NFT):');
        silverHolders.forEach(h => console.log(`   ${h.wallet.slice(0,12)}...${h.wallet.slice(-6)} | ${h.nftCount} NFTs | ${h.totalTickets} tickets`));
        console.log();
      }

      const totalNFTs = holders.reduce((sum, h) => sum + h.nftCount, 0);
      const totalTickets = holders.reduce((sum, h) => sum + h.totalTickets, 0);

      console.log('='.repeat(60));
      console.log('📊 SUMMARY:');
      console.log(`   📦 Total NFT Holders: ${holders.length}`);
      console.log(`   🖼️  Total NFTs Held: ${totalNFTs}`);
      console.log(`   👑 KING holders: ${kingHolders.length}`);
      console.log(`   💎 Platinum: ${platinumHolders.length}`);
      console.log(`   🥇 Gold: ${goldHolders.length}`);
      console.log(`   🥈 Silver: ${silverHolders.length}`);
      console.log(`   🎟️  Total lottery tickets: ${totalTickets}`);
    }

    // Get full lottery status (uses cache)
    console.log('\n\n🎰 Getting Full Lottery Status...');
    const status = await getLotteryStatus();
    console.log(`   💰 Current Pool: ${status.pool} WALDO`);
    console.log(`   📅 Last Scan: ${status.lastScan || 'Never'}`);

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

