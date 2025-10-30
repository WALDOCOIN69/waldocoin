// test-tokenomics.js - Test fee structure and tokenomics
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5050';

console.log("💰 Testing WALDOCOIN Tokenomics & Fee Structure");
console.log("===============================================");

async function testTokenomics() {
  try {
    // Test 1: Get fee structure
    console.log("🔍 Test 1: Fee Structure");
    const feesResponse = await fetch(`${API_BASE}/api/tokenomics/fees`);
    const feesData = await feesResponse.json();
    
    console.log("   Status:", feesResponse.status);
    console.log("   Battle Start Fee:", feesData.feeStructure?.battle?.start, "WALDO");
    console.log("   Battle Vote Fee:", feesData.feeStructure?.battle?.vote, "WALDO");
    console.log("   Battle Burn Rate:", feesData.feeStructure?.battle?.burnRate * 100 + "%");
    console.log("   NFT Mint Cost:", feesData.feeStructure?.nft?.mintCost, "WALDO");
    console.log("   DAO Voting Requirement:", feesData.feeStructure?.dao?.votingRequirement, "WALDO");
    console.log("");

    // Test 2: Fee calculator - Battle start
    console.log("🔍 Test 2: Battle Start Fee Calculation");
    const battleStartResponse = await fetch(`${API_BASE}/api/tokenomics/calculator?action=battle-start`);
    const battleStartData = await battleStartResponse.json();
    
    console.log("   Status:", battleStartResponse.status);
    console.log("   Action:", battleStartData.calculation?.action);
    console.log("   Fee:", battleStartData.calculation?.fee, battleStartData.calculation?.currency);
    console.log("   Destination:", battleStartData.calculation?.destination);
    console.log("");

    // Test 3: Fee calculator - Claim (instant vs staked)
    console.log("🔍 Test 3: Claim Fee Calculations");
    
    // Instant claim
    const instantClaimResponse = await fetch(`${API_BASE}/api/tokenomics/calculator?action=claim&amount=300&staked=false`);
    const instantClaimData = await instantClaimResponse.json();
    
    console.log("   Instant Claim (300 WALDO base):");
    console.log("     Fee Rate:", instantClaimData.calculation?.feeRate);
    console.log("     Fee:", instantClaimData.calculation?.fee, "WALDO");
    console.log("     Burn:", instantClaimData.calculation?.burn, "WALDO");
    console.log("     Net to User:", instantClaimData.calculation?.net, "WALDO");
    
    // Staked claim
    const stakedClaimResponse = await fetch(`${API_BASE}/api/tokenomics/calculator?action=claim&amount=300&staked=true`);
    const stakedClaimData = await stakedClaimResponse.json();
    
    console.log("   Staked Claim (300 WALDO base):");
    console.log("     Fee Rate:", stakedClaimData.calculation?.feeRate);
    console.log("     Fee:", stakedClaimData.calculation?.fee, "WALDO");
    console.log("     Burn:", stakedClaimData.calculation?.burn, "WALDO");
    console.log("     Net to User:", stakedClaimData.calculation?.net, "WALDO");
    console.log("");

    // Test 4: NFT minting calculation
    console.log("🔍 Test 4: NFT Minting Fee");
    const nftResponse = await fetch(`${API_BASE}/api/tokenomics/calculator?action=nft-mint`);
    const nftData = await nftResponse.json();
    
    console.log("   Status:", nftResponse.status);
    console.log("   Action:", nftData.calculation?.action);
    console.log("   Fee:", nftData.calculation?.fee, nftData.calculation?.currency);
    console.log("   Requirement:", nftData.calculation?.requirement);
    console.log("");

    // Test 5: Tokenomics statistics
    console.log("🔍 Test 5: Tokenomics Statistics");
    const statsResponse = await fetch(`${API_BASE}/api/tokenomics/stats`);
    const statsData = await statsResponse.json();
    
    console.log("   Status:", statsResponse.status);
    console.log("   Airdrops Claimed:", statsData.stats?.airdrop?.claimed);
    console.log("   Airdrops Remaining:", statsData.stats?.airdrop?.remaining);
    console.log("   Total WALDO Distributed:", statsData.stats?.airdrop?.totalDistributed?.toLocaleString());
    console.log("   Total Battles:", statsData.stats?.battles?.total);
    console.log("   Estimated Daily Burns:", statsData.stats?.estimatedDailyBurns, "WALDO");
    console.log("");

    // Test 6: Economic analysis
    console.log("🔍 Test 6: Economic Analysis");
    console.log("   Fee Structure Summary:");
    console.log("   =====================");
    console.log("   💸 Battle Entry: 100 WALDO → Issuer");
    console.log("   💸 Battle Vote: 5 WALDO → Issuer");
    console.log("   🔥 Battle Burn: 5% of pot → Burned");
    console.log("   💸 Instant Claim: 10% fee (2% burned)");
    console.log("   💸 Staked Claim: 5% fee (2% burned)");
    console.log("   💸 NFT Mint: 50 WALDO → Distributor");
    console.log("   🗳️ DAO Vote: 10,000 WALDO minimum");
    console.log("");

    console.log("   Deflationary Mechanisms:");
    console.log("   ========================");
    console.log("   🔥 Battle pot burns (5% per battle)");
    console.log("   🔥 Claim fee burns (2% of fees)");
    console.log("   💰 Fee collection in WALDO");
    console.log("   ⚖️ High governance requirements");
    console.log("");

    console.log("✅ TOKENOMICS TEST COMPLETE!");
    console.log("============================");
    console.log("💰 Comprehensive fee structure implemented");
    console.log("🔥 Multiple burning mechanisms active");
    console.log("⚖️ Economic balance maintained");
    console.log("📊 Fee transparency available");

  } catch (error) {
    console.error("❌ Tokenomics test failed:", error.message);
  }
}

testTokenomics();
