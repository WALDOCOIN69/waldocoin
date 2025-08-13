// 🔗 SET WLO TRUSTLINE FOR TRADING WALLET

import xrpl from 'xrpl';

const WALLET_SECRET = process.env.TRADING_WALLET_SECRET;
const WALDO_ISSUER = 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const TRUSTLINE_LIMIT = '976849999'; // Max WALDO tokens

async function setTrustline() {
  console.log('🔗 Setting WLO trustline for trading wallet...\n');

  if (!WALLET_SECRET) {
    console.error('❌ TRADING_WALLET_SECRET environment variable not set');
    return;
  }

  const client = new xrpl.Client('wss://xrplcluster.com');
  await client.connect();
  console.log('✅ Connected to XRPL');

  // Create wallet from secret
  const wallet = xrpl.Wallet.fromSeed(WALLET_SECRET);
  console.log(`📍 Wallet Address: ${wallet.classicAddress}`);

  // Check if trustline already exists
  try {
    const accountLines = await client.request({
      command: 'account_lines',
      account: wallet.classicAddress
    });

    const existingTrustline = accountLines.result.lines.find(
      line => line.currency === 'WLO' && line.account === WALDO_ISSUER
    );

    if (existingTrustline) {
      console.log('✅ WLO trustline already exists!');
      console.log(`   Limit: ${existingTrustline.limit}`);
      console.log(`   Balance: ${existingTrustline.balance}`);
      await client.disconnect();
      return;
    }
  } catch (error) {
    console.log('ℹ️ No existing trustlines found (new wallet)');
  }

  // Create trustline transaction
  const trustlineTransaction = {
    TransactionType: 'TrustSet',
    Account: wallet.classicAddress,
    LimitAmount: {
      currency: 'WLO',
      issuer: WALDO_ISSUER,
      value: TRUSTLINE_LIMIT
    }
  };

  console.log('📝 Preparing trustline transaction...');

  try {
    // Prepare and sign transaction
    const prepared = await client.autofill(trustlineTransaction);
    const signed = wallet.sign(prepared);

    console.log('📤 Submitting trustline transaction...');
    const result = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult === 'tesSUCCESS') {
      console.log('✅ WLO TRUSTLINE SET SUCCESSFULLY!');
      console.log(`🔗 Transaction Hash: ${result.result.hash}`);
      console.log(`📊 View on XRPScan: https://xrpscan.com/tx/${result.result.hash}`);
      console.log(`💰 Trustline Limit: ${TRUSTLINE_LIMIT} WLO`);
    } else {
      console.error('❌ Trustline transaction failed:', result.result.meta.TransactionResult);
    }
  } catch (error) {
    console.error('❌ Error setting trustline:', error.message);
  }

  await client.disconnect();
  console.log('🔌 Disconnected from XRPL');
}

// Run the trustline setup
setTrustline().catch(console.error);
