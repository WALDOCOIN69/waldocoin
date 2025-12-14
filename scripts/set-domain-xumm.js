#!/usr/bin/env node
/**
 * Set Domain Field on XRPL Account via XUMM
 * 
 * This script creates an AccountSet transaction to set the Domain field
 * on your distributor wallet, which helps exchanges verify your token metadata.
 * 
 * Usage: node scripts/set-domain-xumm.js
 */

import xrpl from 'xrpl';
import { XummSdk } from 'xumm-sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../waldocoin-backend/.env') });

// Configuration
const DISTRIBUTOR_WALLET = 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
const DOMAIN = 'waldocoin.live';
const XRPL_NODE = 'wss://xrplcluster.com';

// Convert domain to hex (required by XRPL)
function domainToHex(domain) {
  return Buffer.from(domain, 'utf8').toString('hex').toUpperCase();
}

async function setDomainViaXumm() {
  console.log('🎯 XRPL Domain Setter via XUMM');
  console.log('================================');
  console.log(`Account: ${DISTRIBUTOR_WALLET}`);
  console.log(`Domain: ${DOMAIN}`);
  console.log(`Domain (hex): ${domainToHex(DOMAIN)}`);
  console.log('');

  // Check for XUMM credentials
  const xummApiKey = process.env.XUMM_API_KEY;
  const xummApiSecret = process.env.XUMM_API_SECRET;

  if (!xummApiKey || !xummApiSecret) {
    console.error('❌ Missing XUMM API credentials!');
    console.log('');
    console.log('Please set these in waldocoin-backend/.env:');
    console.log('  XUMM_API_KEY=your_api_key');
    console.log('  XUMM_API_SECRET=your_api_secret');
    console.log('');
    console.log('Get credentials at: https://apps.xumm.dev/');
    process.exit(1);
  }

  // Initialize XUMM SDK
  const xumm = new XummSdk(xummApiKey, xummApiSecret);

  // Create AccountSet transaction
  const accountSetTx = {
    TransactionType: 'AccountSet',
    Account: DISTRIBUTOR_WALLET,
    Domain: domainToHex(DOMAIN),
    Fee: '12'
  };

  console.log('📝 Transaction to sign:');
  console.log(JSON.stringify(accountSetTx, null, 2));
  console.log('');

  try {
    // Create XUMM payload
    console.log('📲 Creating XUMM sign request...');
    const payload = await xumm.payload.create({
      txjson: accountSetTx,
      options: {
        submit: true,
        expire: 5 // 5 minutes to sign
      }
    });

    console.log('');
    console.log('✅ Sign request created!');
    console.log('');
    console.log('🔗 Open this URL to sign with XUMM:');
    console.log(`   ${payload.next.always}`);
    console.log('');
    console.log('📱 Or scan QR code in XUMM app');
    console.log('');

    // Wait for signature
    console.log('⏳ Waiting for signature...');
    const result = await xumm.payload.subscribe(payload.uuid, (event) => {
      if (event.data.signed === true) {
        console.log('✅ Transaction signed!');
        return event.data;
      }
      if (event.data.signed === false) {
        console.log('❌ Transaction rejected');
        return false;
      }
    });

    if (result && result.signed) {
      console.log('');
      console.log('🎉 SUCCESS! Domain has been set.');
      console.log('');
      console.log('Transaction hash:', result.txid);
      console.log('');
      console.log('Next steps:');
      console.log('1. Wait a few minutes for the transaction to be validated');
      console.log('2. Verify at: https://bithomp.com/explorer/' + DISTRIBUTOR_WALLET);
      console.log('3. Exchanges should now be able to find your metadata at:');
      console.log('   https://waldocoin.live/.well-known/xrp-ledger.toml');
    } else {
      console.log('');
      console.log('❌ Transaction was not signed or was rejected.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
setDomainViaXumm().catch(console.error);

