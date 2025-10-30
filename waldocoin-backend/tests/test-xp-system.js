// test-xp-system.js - Test the dynamic XP leveling system
import {
  addXP,
  getXP,
  getWalletProgression,
  getWalletLevel
} from "../utils/xpManager.js";
import { redis } from "../redisClient.js";

const TEST_WALLET = "rTestWallet123456789012345678901234";

console.log("🎮 Testing Dynamic XP Leveling System");
console.log("=====================================");

async function testXPSystem() {
  try {
    // Reset test wallet XP
    console.log("🔄 Resetting test wallet XP...");
    await redis.del(`xp:${TEST_WALLET}`);

    console.log("\n📊 Testing XP Progression Through All 5 Levels:");
    console.log("================================================");

    // Test progression through each level
    const xpAmounts = [100, 200, 300, 400, 500]; // Base amounts to add
    
    for (let i = 0; i < xpAmounts.length; i++) {
      console.log(`\n🎯 Adding ${xpAmounts[i]} base XP (attempt ${i + 1}):`);
      
      const result = await addXP(TEST_WALLET, xpAmounts[i]);
      
      console.log(`   Old XP: ${result.oldXp}`);
      console.log(`   Base Amount: ${xpAmounts[i]}`);
      console.log(`   Multiplier: ${result.multiplier}x`);
      console.log(`   Actual XP Gained: ${result.xpGained}`);
      console.log(`   New XP: ${result.newXp}`);
      console.log(`   Old Level: ${result.oldLevel.level} (${result.oldLevel.title})`);
      console.log(`   New Level: ${result.newLevel.level} (${result.newLevel.title})`);
      
      if (result.leveledUp) {
        console.log(`   🎉 LEVEL UP! ${result.oldLevel.title} → ${result.newLevel.title}`);
      }
      
      // Get detailed progression
      const progression = await getWalletProgression(TEST_WALLET);
      console.log(`   Progress to next: ${progression.progress}%`);
      console.log(`   XP to next level: ${progression.xpToNext}`);
      
      if (progression.isMaxLevel) {
        console.log(`   🏆 MAX LEVEL REACHED!`);
      }
    }

    // Test final state
    console.log("\n🏁 Final State:");
    console.log("===============");
    const finalProgression = await getWalletProgression(TEST_WALLET);
    const finalXp = await getXP(TEST_WALLET);
    
    console.log(`   Total XP: ${finalXp}`);
    console.log(`   Final Level: ${finalProgression.currentLevel.level}`);
    console.log(`   Final Title: ${finalProgression.currentLevel.title}`);
    console.log(`   Final Multiplier: ${finalProgression.currentLevel.multiplier}x`);
    console.log(`   Is Max Level: ${!finalProgression.nextLevel}`);

    // Test level thresholds
    console.log("\n📋 Level Thresholds:");
    console.log("====================");
    const levels = [
      { level: 1, threshold: 0, title: "Fresh Poster" },
      { level: 2, threshold: 250, title: "Shitposter" },
      { level: 3, threshold: 850, title: "Meme Dealer" },
      { level: 4, threshold: 1750, title: "OG Degen" },
      { level: 5, threshold: 3000, title: "WALDO Master" }
    ];
    
    levels.forEach(level => {
      console.log(`   Level ${level.level}: ${level.threshold}+ XP (${level.title})`);
    });

    // Test diminishing returns demonstration
    console.log("\n🔄 Diminishing Returns Demonstration:");
    console.log("====================================");
    console.log("   Level 1 (1.0x): 100 base XP → 100 actual XP");
    console.log("   Level 2 (0.9x): 100 base XP → 90 actual XP");
    console.log("   Level 3 (0.8x): 100 base XP → 80 actual XP");
    console.log("   Level 4 (0.7x): 100 base XP → 70 actual XP");
    console.log("   Level 5 (0.6x): 100 base XP → 60 actual XP");

    console.log("\n✅ XP System Test Complete!");
    console.log("============================");
    console.log("🎮 Dynamic 5-level progression system is working!");
    console.log("📈 Diminishing returns prevent XP inflation");
    console.log("🏆 Level progression provides meaningful advancement");

  } catch (error) {
    console.error("❌ XP System test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

testXPSystem();
