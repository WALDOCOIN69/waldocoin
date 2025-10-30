// Test script to check if autodistribute system is working
import xrpl from "xrpl";
import dotenv from "dotenv";

dotenv.config();

const distributorWallet = process.env.DISTRIBUTOR_WALLET;
const distributorSecret = process.env.WALDO_DISTRIBUTOR_SECRET || process.env.DISTRIBUTOR_SECRET;

console.log("🔍 Testing Autodistribute System");
console.log("================================");

// Check environment variables
console.log("📋 Environment Variables:");
console.log(`DISTRIBUTOR_WALLET: ${distributorWallet || 'NOT SET'}`);
console.log(`DISTRIBUTOR_SECRET: ${distributorSecret ? 'SET' : 'NOT SET'}`);
console.log(`WALDO_ISSUER: ${process.env.WALDO_ISSUER || 'NOT SET'}`);
console.log(`WALDOCOIN_TOKEN: ${process.env.WALDOCOIN_TOKEN || 'NOT SET'}`);

if (!distributorWallet) {
  console.error("❌ DISTRIBUTOR_WALLET not set - autodistribute won't work");
  process.exit(1);
}

if (!distributorSecret) {
  console.error("❌ DISTRIBUTOR_SECRET not set - autodistribute can't send WALDO");
  process.exit(1);
}

// Test XRPL connection
async function testXRPLConnection() {
  console.log("\n🌐 Testing XRPL Connection...");
  const client = new xrpl.Client("wss://xrplcluster.com");
  
  try {
    await client.connect();
    console.log("✅ XRPL connection successful");
    
    // Test distributor wallet
    const distributorWalletObj = xrpl.Wallet.fromSeed(distributorSecret);
    console.log(`📍 Distributor wallet address: ${distributorWalletObj.classicAddress}`);
    
    if (distributorWalletObj.classicAddress !== distributorWallet) {
      console.error(`❌ WALLET MISMATCH! Secret generates ${distributorWalletObj.classicAddress} but env says ${distributorWallet}`);
    } else {
      console.log("✅ Wallet address matches secret");
    }
    
    // Check wallet balance
    const accountInfo = await client.request({
      command: "account_info",
      account: distributorWallet
    });
    
    const balance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);
    console.log(`💰 Distributor wallet balance: ${balance} XRP`);
    
    await client.disconnect();
    
  } catch (error) {
    console.error("❌ XRPL connection failed:", error.message);
    await client.disconnect();
  }
}

// Test market pricing
async function testMarketPricing() {
  console.log("\n📊 Testing Market Pricing...");
  
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://waldocoin-backend-api.onrender.com/api/market/wlo');
    const data = await response.json();
    
    console.log("Market data:", JSON.stringify(data, null, 2));
    
    const xrpPerWlo = data?.xrpPerWlo || data?.best?.mid;
    if (xrpPerWlo && isFinite(xrpPerWlo) && xrpPerWlo > 0) {
      console.log(`✅ Market rate: ${xrpPerWlo} XRP/WLO`);
      
      // Test calculation
      const testXrp = 10;
      const testWaldo = Math.floor(testXrp / xrpPerWlo);
      console.log(`📈 Example: ${testXrp} XRP = ${testWaldo} WALDO`);
    } else {
      console.error("❌ Invalid market rate");
    }
    
  } catch (error) {
    console.error("❌ Market pricing test failed:", error.message);
  }
}

// Run tests
async function runTests() {
  await testXRPLConnection();
  await testMarketPricing();
  
  console.log("\n🎯 Summary:");
  console.log("If all tests pass, autodistribute should work when deployed.");
  console.log("If tests fail, that's why WALDO isn't being distributed.");
}

runTests();
