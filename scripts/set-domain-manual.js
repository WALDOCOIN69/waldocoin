#!/usr/bin/env node
/**
 * Generate Domain Set Transaction for Manual Signing
 * 
 * This script generates the AccountSet transaction that you can
 * sign manually using XUMM or any XRPL wallet.
 * 
 * Usage: node scripts/set-domain-manual.js
 */

import xrpl from 'xrpl';

// Configuration
const DISTRIBUTOR_WALLET = 'rMFoici99gcnXMjKwzJWP2WGe9bK4E5iLL';
const DOMAIN = 'waldocoin.live';
const XRPL_NODE = 'wss://xrplcluster.com';

// Convert domain to hex (required by XRPL)
function domainToHex(domain) {
  return Buffer.from(domain, 'utf8').toString('hex').toUpperCase();
}

async function generateTransaction() {
  console.log('🎯 XRPL Domain Setter - Manual Transaction');
  console.log('==========================================');
  console.log(`Account: ${DISTRIBUTOR_WALLET}`);
  console.log(`Domain: ${DOMAIN}`);
  console.log(`Domain (hex): ${domainToHex(DOMAIN)}`);
  console.log('');

  // Connect to XRPL to get current sequence
  console.log('📡 Connecting to XRPL...');
  const client = new xrpl.Client(XRPL_NODE);
  await client.connect();

  try {
    // Get account info for sequence number
    const accountInfo = await client.request({
      command: 'account_info',
      account: DISTRIBUTOR_WALLET,
      ledger_index: 'validated'
    });

    const sequence = accountInfo.result.account_data.Sequence;
    
    // Get current ledger for LastLedgerSequence
    const ledgerInfo = await client.request({
      command: 'ledger',
      ledger_index: 'validated'
    });
    
    const currentLedger = ledgerInfo.result.ledger_index;
    const lastLedgerSequence = currentLedger + 100; // Valid for ~100 ledgers (~5 minutes)

    // Create the transaction
    const accountSetTx = {
      TransactionType: 'AccountSet',
      Account: DISTRIBUTOR_WALLET,
      Domain: domainToHex(DOMAIN),
      Fee: '12',
      Sequence: sequence,
      LastLedgerSequence: lastLedgerSequence
    };

    console.log('');
    console.log('✅ Transaction generated successfully!');
    console.log('');
    console.log('📝 Transaction JSON (copy this):');
    console.log('─'.repeat(50));
    console.log(JSON.stringify(accountSetTx, null, 2));
    console.log('─'.repeat(50));
    console.log('');
    console.log('📋 How to sign this transaction:');
    console.log('');
    console.log('Option 1: XUMM App');
    console.log('  1. Open XUMM → Settings → Advanced → Sign Request');
    console.log('  2. Paste the transaction JSON above');
    console.log('  3. Review and sign');
    console.log('');
    console.log('Option 2: XRPL Tools');
    console.log('  1. Go to https://livenet.xrpl.org/tools/account');
    console.log('  2. Connect your wallet');
    console.log('  3. Set domain in account settings');
    console.log('');
    console.log('Option 3: XRP Toolkit');
    console.log('  1. Go to https://www.xrptoolkit.com/');
    console.log('  2. Connect wallet → Account → Settings');
    console.log('  3. Enter domain: ' + DOMAIN);
    console.log('');
    console.log('⏱️  Note: Transaction expires in ~5 minutes (ledger ' + lastLedgerSequence + ')');
    console.log('');
    console.log('After signing, verify at:');
    console.log('  https://bithomp.com/explorer/' + DISTRIBUTOR_WALLET);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.disconnect();
  }
}

// Run the script
generateTransaction().catch(console.error);

