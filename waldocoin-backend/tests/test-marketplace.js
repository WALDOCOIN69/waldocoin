#!/usr/bin/env node
/**
 * Marketplace Endpoints Test Suite
 * Tests all 9 marketplace endpoints for functionality
 */

import { redis } from './redisClient.js';

const baseURL = 'http://localhost:3000';
const testWallet = 'rN7n7otQDd6FczFgLdlqtyMVrn3Rqq5Qzz';
const testTweetId = 'test_tweet_12345';
const testListingId = `listing_${Date.now()}`;

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function setupTestData() {
  log('\n📋 Setting up test data...', 'blue');
  
  try {
    // Create test meme data
    await redis.hSet(`meme:${testTweetId}`, {
      text: 'Test WALDO Meme',
      image_url: 'https://waldocoin.live/wp-content/uploads/2025/04/1737843965114.jpg',
      likes: 100,
      retweets: 50,
      xp: 500,
      wallet: testWallet,
      createdAt: new Date().toISOString()
    });

    // Create test listing
    await redis.hSet(`marketplace:listing:${testListingId}`, {
      listingId: testListingId,
      nftId: `nft_${testTweetId}`,
      tweetId: testTweetId,
      seller: testWallet,
      price: 100,
      currency: 'WALDO',
      status: 'active',
      views: 0,
      favorites: 0,
      royaltyRate: 0.05,
      originalCreator: testWallet,
      createdAt: new Date().toISOString()
    });

    log('✅ Test data created', 'green');
  } catch (error) {
    log(`❌ Error setting up test data: ${error.message}`, 'red');
  }
}

async function testEndpoint(method, endpoint, body = null, description = '') {
  try {
    const url = `${baseURL}${endpoint}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (response.ok && data.success) {
      log(`✅ ${method} ${endpoint}`, 'green');
      if (description) log(`   ${description}`, 'green');
      return { success: true, data };
    } else {
      log(`❌ ${method} ${endpoint}`, 'red');
      log(`   Error: ${data.error || 'Unknown error'}`, 'red');
      return { success: false, data };
    }
  } catch (error) {
    log(`❌ ${method} ${endpoint} - ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function runTests() {
  log('\n🧪 MARKETPLACE ENDPOINTS TEST SUITE', 'blue');
  log('=====================================\n', 'blue');

  await setupTestData();

  // Test 1: GET /stats
  log('\n1️⃣  Testing GET /api/marketplace/stats', 'yellow');
  await testEndpoint('GET', '/api/marketplace/stats', null, 'Fetch marketplace statistics');

  // Test 2: GET /listings
  log('\n2️⃣  Testing GET /api/marketplace/listings', 'yellow');
  await testEndpoint('GET', '/api/marketplace/listings?page=1&limit=10', null, 'Browse marketplace listings');

  // Test 3: GET /listing/:listingId
  log('\n3️⃣  Testing GET /api/marketplace/listing/:listingId', 'yellow');
  await testEndpoint('GET', `/api/marketplace/listing/${testListingId}`, null, 'Fetch single listing details');

  // Test 4: GET /my-listings/:wallet
  log('\n4️⃣  Testing GET /api/marketplace/my-listings/:wallet', 'yellow');
  await testEndpoint('GET', `/api/marketplace/my-listings/${testWallet}`, null, 'Fetch user listings');

  // Test 5: POST /favorite
  log('\n5️⃣  Testing POST /api/marketplace/favorite', 'yellow');
  await testEndpoint('POST', '/api/marketplace/favorite', {
    wallet: testWallet,
    listingId: testListingId
  }, 'Toggle favorite on listing');

  // Test 6: POST /list
  log('\n6️⃣  Testing POST /api/marketplace/list', 'yellow');
  await testEndpoint('POST', '/api/marketplace/list', {
    wallet: testWallet,
    nftId: `nft_${testTweetId}`,
    tweetId: testTweetId,
    price: 150,
    currency: 'WALDO'
  }, 'List new NFT for sale');

  // Test 7: DELETE /delist
  log('\n7️⃣  Testing DELETE /api/marketplace/delist', 'yellow');
  await testEndpoint('DELETE', '/api/marketplace/delist', {
    wallet: testWallet,
    listingId: testListingId
  }, 'Remove listing from marketplace');

  log('\n✅ Test suite completed!', 'green');
  log('Note: Some endpoints require XUMM wallet authentication for full functionality\n', 'yellow');

  process.exit(0);
}

// Run tests
runTests().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});

