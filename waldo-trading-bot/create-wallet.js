// 🔧 XRPL WALLET GENERATOR FOR WALDO VOLUME BOT

import xrpl from 'xrpl';

console.log('🔧 Generating new XRPL wallet for WALDO volume bot...\n');

// Generate new wallet
const wallet = xrpl.Wallet.generate();

console.log('✅ NEW TRADING WALLET CREATED:');
console.log('=====================================');
console.log(`📍 Address: ${wallet.classicAddress}`);
console.log(`🔑 Secret:  ${wallet.seed}`);
console.log(`🔐 Private: ${wallet.privateKey}`);
console.log(`🔓 Public:  ${wallet.publicKey}`);
console.log('=====================================\n');

console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('• Keep the SECRET KEY safe and private');
console.log('• Never share it with anyone');
console.log('• Use only for the trading bot');
console.log('• This wallet is separate from your main wallet\n');

console.log('📋 NEXT STEPS:');
console.log('1. Fund this wallet with XRP (100-300 XRP recommended)');
console.log('2. Add WALDO trustline to this wallet');
console.log('3. Transfer WALDO tokens to this wallet (500K-1M WLO)');
console.log('4. Add the SECRET KEY to Render environment variables');
console.log('5. Deploy the volume bot\n');

console.log('🔑 ENVIRONMENT VARIABLE:');
console.log(`TRADING_WALLET_SECRET=${wallet.seed}`);
console.log(`TRADING_WALLET_ADDRESS=${wallet.classicAddress}\n`);

console.log('🚀 Ready to fund and configure your volume bot wallet!');
