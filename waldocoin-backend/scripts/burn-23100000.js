#!/usr/bin/env node
// scripts/burn-23100000.js - Burn 23,100,000 WLO tokens on-chain
import dotenv from 'dotenv';
import { Client, Wallet } from 'xrpl';
import { redis } from '../redisClient.js';

// Load environment variables
dotenv.config();

// Configuration
const BURN_AMOUNT = 23100000; // 23.1 million WLO tokens
const BURN_REASON = 'Strategic token burn - Reducing total supply for tokenomics optimization';
const XRPL_SERVER = process.env.XRPL_NODE || 'wss://xrplcluster.com';
const WALDO_ISSUER = process.env.WALDO_ISSUER || 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET || process.env.WALDO_DISTRIBUTOR_SECRET;

console.log('🔥 WALDOCOIN MASSIVE TOKEN BURN SCRIPT');
console.log('=====================================');
console.log(`Amount to burn: ${BURN_AMOUNT.toLocaleString()} WLO tokens`);
console.log(`Reason: ${BURN_REASON}`);
console.log(`XRPL Server: ${XRPL_SERVER}`);
console.log(`WALDO Issuer: ${WALDO_ISSUER}`);
console.log('=====================================');

async function burnTokens() {
  let client;
  
  try {
    // Validate environment
    if (!DISTRIBUTOR_SECRET) {
      throw new Error('❌ DISTRIBUTOR_SECRET not found in environment variables');
    }

    console.log('🔑 Creating wallet from secret...');
    const wallet = Wallet.fromSeed(DISTRIBUTOR_SECRET);
    console.log(`✅ Wallet created: ${wallet.classicAddress}`);

    // Connect to XRPL
    console.log('📡 Connecting to XRPL...');
    client = new Client(XRPL_SERVER);
    await client.connect();
    console.log('✅ Connected to XRPL');

    // Check wallet balance before burning
    console.log('💰 Checking wallet balance...');
    const accountInfo = await client.request({
      command: 'account_lines',
      account: wallet.classicAddress,
      ledger_index: 'validated'
    });

    const waldoLine = accountInfo.result.lines.find(line => 
      line.currency === 'WLO' && line.account === WALDO_ISSUER
    );

    if (!waldoLine) {
      throw new Error('❌ No WLO trustline found in wallet');
    }

    const currentBalance = parseFloat(waldoLine.balance);
    console.log(`💰 Current WLO balance: ${currentBalance.toLocaleString()}`);

    if (currentBalance < BURN_AMOUNT) {
      throw new Error(`❌ Insufficient balance. Need ${BURN_AMOUNT.toLocaleString()}, have ${currentBalance.toLocaleString()}`);
    }

    // Confirm burn
    console.log('\n⚠️  FINAL CONFIRMATION REQUIRED ⚠️');
    console.log(`You are about to burn ${BURN_AMOUNT.toLocaleString()} WLO tokens`);
    console.log('This action is IRREVERSIBLE and will permanently remove tokens from circulation');
    console.log('\nTo proceed, you must set the environment variable CONFIRM_BURN=true');
    
    if (process.env.CONFIRM_BURN !== 'true') {
      console.log('❌ Burn not confirmed. Set CONFIRM_BURN=true to proceed.');
      process.exit(1);
    }

    console.log('✅ Burn confirmed. Proceeding...');

    // Create burn transaction
    console.log('📝 Creating burn transaction...');
    const burnTransaction = {
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: WALDO_ISSUER,
      Amount: {
        currency: 'WLO',
        issuer: WALDO_ISSUER,
        value: BURN_AMOUNT.toString()
      },
      Memos: [{
        Memo: {
          MemoType: Buffer.from('MASSIVE_TOKEN_BURN').toString('hex').toUpperCase(),
          MemoData: Buffer.from(BURN_REASON).toString('hex').toUpperCase()
        }
      }]
    };

    console.log('🔥 Submitting burn transaction...');
    console.log('⏳ This may take a few moments...');

    // Submit and wait for validation
    const response = await client.submitAndWait(burnTransaction, { wallet });

    if (response.result.meta.TransactionResult === 'tesSUCCESS') {
      const txHash = response.result.hash;
      const fee = response.result.Fee;
      
      console.log('\n🎉 BURN SUCCESSFUL! 🎉');
      console.log('========================');
      console.log(`✅ Transaction Hash: ${txHash}`);
      console.log(`🔥 Tokens Burned: ${BURN_AMOUNT.toLocaleString()} WLO`);
      console.log(`💸 Transaction Fee: ${fee} drops`);
      console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
      console.log('========================');

      // Record burn event in Redis
      try {
        console.log('📊 Recording burn event...');
        const burnEvent = {
          amount: BURN_AMOUNT,
          reason: BURN_REASON,
          txHash: txHash,
          timestamp: new Date().toISOString(),
          wallet: wallet.classicAddress,
          issuer: WALDO_ISSUER,
          fee: fee,
          type: 'massive_burn'
        };

        // Store in Redis for tracking
        await redis.lPush('token_burns', JSON.stringify(burnEvent));
        await redis.incrByFloat('total_tokens_burned', BURN_AMOUNT);

        // Store daily burn tracking
        const today = new Date().toISOString().split('T')[0];
        const dailyKey = `burns:${today}`;
        await redis.rPush(dailyKey, JSON.stringify(burnEvent));
        await redis.expire(dailyKey, 86400 * 365); // Keep for 1 year

        console.log('✅ Burn event recorded in database');

      } catch (redisError) {
        console.warn('⚠️  Failed to record burn event in Redis:', redisError.message);
        console.log('🔥 Burn was successful on-chain, but database recording failed');
      }

      // Check new balance
      console.log('💰 Checking new balance...');
      const newAccountInfo = await client.request({
        command: 'account_lines',
        account: wallet.classicAddress,
        ledger_index: 'validated'
      });

      const newWaldoLine = newAccountInfo.result.lines.find(line => 
        line.currency === 'WLO' && line.account === WALDO_ISSUER
      );

      if (newWaldoLine) {
        const newBalance = parseFloat(newWaldoLine.balance);
        console.log(`💰 New WLO balance: ${newBalance.toLocaleString()}`);
        console.log(`🔥 Confirmed burned: ${(currentBalance - newBalance).toLocaleString()} WLO`);
      }

      console.log('\n🌐 View transaction on XRPL Explorer:');
      console.log(`https://livenet.xrpl.org/transactions/${txHash}`);

    } else {
      throw new Error(`❌ Transaction failed: ${response.result.meta.TransactionResult}`);
    }

  } catch (error) {
    console.error('\n❌ BURN FAILED');
    console.error('===============');
    console.error('Error:', error.message);
    
    if (error.message.includes('tecUNFUNDED_PAYMENT')) {
      console.error('💡 This usually means insufficient balance or trustline issues');
    } else if (error.message.includes('tecNO_LINE')) {
      console.error('💡 No trustline found for WLO token');
    } else if (error.message.includes('tecPATH_DRY')) {
      console.error('💡 Insufficient liquidity or balance');
    }
    
    process.exit(1);
    
  } finally {
    if (client && client.isConnected()) {
      console.log('🔌 Disconnecting from XRPL...');
      await client.disconnect();
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  Process interrupted. Exiting safely...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Process terminated. Exiting safely...');
  process.exit(0);
});

// Run the burn
console.log('🚀 Starting burn process...');
burnTokens().then(() => {
  console.log('✅ Burn process completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Burn process failed:', error);
  process.exit(1);
});
