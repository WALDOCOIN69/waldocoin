#!/usr/bin/env node
// 🔗 XRPL Domain Verification Setup Script

import { Client, Wallet } from 'xrpl';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const XRPL_NODE = process.env.XRPL_NODE || 'wss://xrplcluster.com';
const ISSUER_SECRET = process.env.WALDO_ISSUER_SECRET; // You'll need this
const DOMAIN = 'waldocoin.live';

async function setupDomainVerification() {
  console.log('🔗 Setting up XRPL domain verification for WALDO token...');
  
  if (!ISSUER_SECRET) {
    console.error('❌ WALDO_ISSUER_SECRET environment variable is required');
    console.log('💡 This should be the secret key for: rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY');
    process.exit(1);
  }

  const client = new Client(XRPL_NODE);
  
  try {
    await client.connect();
    console.log('✅ Connected to XRPL');

    const issuerWallet = Wallet.fromSeed(ISSUER_SECRET);
    console.log(`🔑 Issuer wallet: ${issuerWallet.classicAddress}`);

    // Check if domain is already set
    const accountInfo = await client.request({
      command: 'account_info',
      account: issuerWallet.classicAddress,
      ledger_index: 'validated'
    });

    const currentDomain = accountInfo.result.account_data.Domain;
    if (currentDomain) {
      const decodedDomain = Buffer.from(currentDomain, 'hex').toString('utf8');
      console.log(`📋 Current domain: ${decodedDomain}`);
      
      if (decodedDomain === DOMAIN) {
        console.log('✅ Domain already set correctly!');
        return;
      }
    }

    // Set domain on issuer account
    const domainHex = Buffer.from(DOMAIN, 'utf8').toString('hex').toUpperCase();
    
    const accountSetTx = {
      TransactionType: 'AccountSet',
      Account: issuerWallet.classicAddress,
      Domain: domainHex
    };

    console.log(`🔧 Setting domain to: ${DOMAIN}`);
    console.log(`📝 Domain hex: ${domainHex}`);

    const prepared = await client.autofill(accountSetTx);
    const signed = issuerWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      console.log('✅ Domain verification set successfully!');
      console.log(`🔗 Transaction hash: ${result.result.hash}`);
      console.log(`📋 Domain: ${DOMAIN}`);
      
      console.log('\n📋 Next Steps:');
      console.log('1. Upload the .well-known/xrp-ledger.toml file to your website');
      console.log('2. Ensure it\'s accessible at: https://waldocoin.live/.well-known/xrp-ledger.toml');
      console.log('3. Upload token logo to: https://waldocoin.live/assets/waldo-token-logo.png');
      console.log('4. Test the setup with XRPL explorers');
      
    } else {
      console.error('❌ Domain verification failed:', result.result.meta.TransactionResult);
    }

  } catch (error) {
    console.error('❌ Error setting up domain verification:', error);
  } finally {
    await client.disconnect();
  }
}

// Verify domain setup
async function verifyDomainSetup() {
  console.log('\n🔍 Verifying domain setup...');
  
  try {
    // Check if .well-known file is accessible
    const response = await fetch(`https://${DOMAIN}/.well-known/xrp-ledger.toml`);
    
    if (response.ok) {
      const content = await response.text();
      console.log('✅ Domain verification file is accessible');
      
      // Check if it contains our token info
      if (content.includes('rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY') && content.includes('WLO')) {
        console.log('✅ Token metadata found in verification file');
      } else {
        console.log('⚠️ Token metadata not found in verification file');
      }
    } else {
      console.log('❌ Domain verification file not accessible');
      console.log('💡 Make sure to upload .well-known/xrp-ledger.toml to your website');
    }
    
    // Check token logo
    const logoResponse = await fetch(`https://${DOMAIN}/assets/waldo-token-logo.png`);
    if (logoResponse.ok) {
      console.log('✅ Token logo is accessible');
    } else {
      console.log('❌ Token logo not accessible');
      console.log('💡 Upload your token logo to /assets/waldo-token-logo.png');
    }
    
  } catch (error) {
    console.log('⚠️ Could not verify domain setup:', error.message);
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      await setupDomainVerification();
      break;
    case 'verify':
      await verifyDomainSetup();
      break;
    default:
      console.log('🎯 XRPL Domain Verification Tool');
      console.log('');
      console.log('Usage:');
      console.log('  node setup-domain-verification.js setup   - Set domain on issuer account');
      console.log('  node setup-domain-verification.js verify  - Verify domain setup');
      console.log('');
      console.log('Environment variables required:');
      console.log('  WALDO_ISSUER_SECRET - Secret key for rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY');
      break;
  }
}

main().catch(console.error);
