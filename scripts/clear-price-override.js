#!/usr/bin/env node
/**
 * Clear the admin price override from Redis
 * This will allow the /api/market/wlo endpoint to return real DEX prices
 * 
 * Usage: X_ADMIN_KEY=your_admin_key node scripts/clear-price-override.js
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.BASE_URL || 'https://waldocoin-backend-api.onrender.com';
const ADMIN_KEY = process.env.X_ADMIN_KEY;

if (!ADMIN_KEY) {
  console.error('❌ X_ADMIN_KEY environment variable is required');
  console.log('\nUsage: X_ADMIN_KEY=your_admin_key node scripts/clear-price-override.js');
  process.exit(1);
}

async function clearPriceOverride() {
  console.log('🧹 Clearing price override...\n');

  try {
    const response = await fetch(`${BASE_URL}/api/admin/price/override`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': ADMIN_KEY
      }
    });

    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('✅ Price override cleared successfully!');
      console.log('📊 The /api/market/wlo endpoint will now return real DEX prices.\n');
    } else {
      console.error('❌ Failed to clear override:', data.error || 'Unknown error');
      process.exit(1);
    }

    // Verify by checking current price
    console.log('🔍 Verifying current price...');
    const verifyRes = await fetch(`${BASE_URL}/api/market/wlo`);
    const verifyData = await verifyRes.json();
    
    console.log('\n📈 Current Market Data:');
    console.log(`   Source: ${verifyData.source?.used || 'unknown'}`);
    console.log(`   XRP per WLO: ${verifyData.xrpPerWlo}`);
    console.log(`   Best Bid: ${verifyData.best?.bid || 'N/A'}`);
    console.log(`   Best Ask: ${verifyData.best?.ask || 'N/A'}`);
    console.log(`   Mid: ${verifyData.best?.mid || 'N/A'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearPriceOverride();

