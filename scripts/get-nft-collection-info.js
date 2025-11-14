/**
 * Get NFT Collection Info for XRP Cafe Listing
 * This script helps you gather the information needed to list your collection on XRP Cafe
 */

import xrpl from 'xrpl';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try loading from both root and waldocoin-backend
dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../waldocoin-backend/.env') });

async function getCollectionInfo() {
  console.log('🔍 Fetching NFT Collection Information...\n');

  const client = new xrpl.Client('wss://xrplcluster.com');
  await client.connect();

  // Get issuer wallet address from env
  const issuerSeed = process.env.MINTING_WALLET_SECRET || process.env.WALDO_DISTRIBUTOR_SECRET;

  if (!issuerSeed) {
    console.error('❌ MINTING_WALLET_SECRET or WALDO_DISTRIBUTOR_SECRET not found in .env file');
    console.log('\n💡 Please add one of these to your .env file');
    await client.disconnect();
    return;
  }

  const issuerWallet = xrpl.Wallet.fromSeed(issuerSeed);
  const issuerAddress = issuerWallet.classicAddress;

  console.log('📋 COLLECTION INFORMATION FOR XRP CAFE:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🏦 Issuer Wallet Address: ${issuerAddress}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get account NFTs
    const nfts = await client.request({
      command: 'account_nfts',
      account: issuerAddress,
      limit: 400
    });

    if (!nfts.result.account_nfts || nfts.result.account_nfts.length === 0) {
      console.log('⚠️  No NFTs found for this issuer wallet');
      console.log('   Make sure you have minted NFTs with this wallet\n');
      await client.disconnect();
      return;
    }

    // Group NFTs by taxon
    const taxonGroups = {};
    nfts.result.account_nfts.forEach(nft => {
      const taxon = nft.NFTokenTaxon || 0;
      if (!taxonGroups[taxon]) {
        taxonGroups[taxon] = [];
      }
      taxonGroups[taxon].push(nft);
    });

    console.log('📊 NFT COLLECTIONS BY TAXON:\n');
    
    Object.keys(taxonGroups).forEach(taxon => {
      const count = taxonGroups[taxon].length;
      console.log(`🎨 Taxon ${taxon}:`);
      console.log(`   └─ ${count} NFT${count > 1 ? 's' : ''} minted`);
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 TO LIST ON XRP CAFE:\n');
    console.log('1. Go to: https://xrp.cafe/');
    console.log('2. Look for "List your collection" or similar option');
    console.log('3. Connect with your issuer wallet (use XUMM or another wallet)');
    console.log('4. Enter the following information:\n');
    console.log(`   📍 Issuer Address: ${issuerAddress}`);
    
    // Show each taxon
    Object.keys(taxonGroups).forEach(taxon => {
      const count = taxonGroups[taxon].length;
      console.log(`   🔢 Taxon: ${taxon} (${count} NFTs)`);
    });
    
    console.log('\n5. Add collection details:');
    console.log('   - Collection Name: "WALDOCOIN Memes" (or your choice)');
    console.log('   - Description: Describe your NFT collection');
    console.log('   - Thumbnail: Upload a collection image');
    console.log('   - Website: https://waldocoin.live');
    console.log('   - Twitter/Social: Your social media links');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Show sample NFTs
    console.log('🖼️  SAMPLE NFTs FROM YOUR COLLECTION:\n');
    Object.keys(taxonGroups).forEach(taxon => {
      const samples = taxonGroups[taxon].slice(0, 3);
      console.log(`Taxon ${taxon} samples:`);
      samples.forEach((nft, idx) => {
        const uri = nft.URI ? Buffer.from(nft.URI, 'hex').toString('utf8') : 'No URI';
        console.log(`   ${idx + 1}. NFTokenID: ${nft.NFTokenID}`);
        console.log(`      URI: ${uri.substring(0, 60)}${uri.length > 60 ? '...' : ''}`);
      });
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error fetching NFTs:', error.message);
  }

  await client.disconnect();
  console.log('✅ Done!\n');
}

getCollectionInfo().catch(console.error);

