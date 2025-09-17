// clearAllStakingData.js - Completely wipe all staking data from Redis
import { connectRedis } from '../redisClient.js';

async function clearAllStakingData() {
  console.log('🔥 CLEARING ALL STAKING DATA FROM REDIS...');
  
  const redis = await connectRedis();
  
  try {
    // Get all keys that contain staking data
    const stakingKeys = await redis.keys('staking:*');
    const userStakeKeys = await redis.keys('user:*:long_term_stakes');
    const userStakeGenericKeys = await redis.keys('staking:user:*');
    const stakingStatsKeys = await redis.keys('staking:total_*');
    const stakingLockKeys = await redis.keys('stake:*');
    
    console.log(`Found ${stakingKeys.length} staking: keys`);
    console.log(`Found ${userStakeKeys.length} user long_term_stakes keys`);
    console.log(`Found ${userStakeGenericKeys.length} staking:user: keys`);
    console.log(`Found ${stakingStatsKeys.length} staking stats keys`);
    console.log(`Found ${stakingLockKeys.length} stake lock keys`);
    
    // Delete all staking-related keys
    const allKeys = [
      ...stakingKeys,
      ...userStakeKeys, 
      ...userStakeGenericKeys,
      ...stakingStatsKeys,
      ...stakingLockKeys
    ];
    
    if (allKeys.length > 0) {
      console.log(`🗑️ Deleting ${allKeys.length} keys...`);
      await redis.del(allKeys);
      console.log('✅ All staking data deleted');
    } else {
      console.log('ℹ️ No staking data found to delete');
    }
    
    // Reset staking counters to 0
    await redis.set('staking:total_staked', '0');
    await redis.set('staking:total_long_term_staked', '0');
    await redis.set('staking:total_penalties', '0');
    await redis.set('staking:total_rewards_paid', '0');
    
    console.log('✅ Reset all staking counters to 0');
    
    // List remaining keys for verification
    const remainingStakingKeys = await redis.keys('*stak*');
    if (remainingStakingKeys.length > 0) {
      console.log('⚠️ Remaining staking-related keys:');
      remainingStakingKeys.forEach(key => console.log(`  - ${key}`));
    } else {
      console.log('✅ No remaining staking keys found');
    }
    
    console.log('🎉 STAKING DATA CLEARED SUCCESSFULLY');
    
  } catch (error) {
    console.error('❌ Error clearing staking data:', error);
  } finally {
    await redis.quit();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  clearAllStakingData().catch(console.error);
}

export { clearAllStakingData };
