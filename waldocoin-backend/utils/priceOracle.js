/**
 * 💰 Price Oracle for WALDOCOIN Ecosystem
 *
 * Fetches real-time prices for XRP and WLO tokens
 * Used for premium subscriptions and payment calculations
 */

import axios from 'axios';

console.log("💰 Loaded: utils/priceOracle.js");

// Cache prices for 24 hours to reduce API calls
let priceCache = {
  xrp: { price: null, timestamp: 0 },
  wlo: { price: null, timestamp: 0 }
};

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get current XRP price in USD from CoinGecko
 * @returns {Promise<number>} XRP price in USD
 */
async function getXRPPrice() {
  try {
    const now = Date.now();
    
    // Return cached price if still valid
    if (priceCache.xrp.price && (now - priceCache.xrp.timestamp) < CACHE_DURATION) {
      console.log(`💎 Using cached XRP price: $${priceCache.xrp.price}`);
      return priceCache.xrp.price;
    }

    // Fetch from CoinGecko
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ripple',
        vs_currencies: 'usd'
      },
      timeout: 5000
    });

    const price = response.data?.ripple?.usd;
    
    if (price) {
      priceCache.xrp = { price, timestamp: now };
      console.log(`💎 Fetched XRP price: $${price}`);
      return price;
    }

    // Fallback to default if API fails
    console.warn('⚠️ Failed to fetch XRP price, using default $2.50');
    return 2.50;
  } catch (error) {
    console.error('❌ Error fetching XRP price:', error.message);
    return 2.50; // Default fallback
  }
}

/**
 * Get current WLO price in USD from GeckoTerminal (XRPL DEX)
 * Pool: WLO / XRP on First Ledger DEX
 * @returns {Promise<number>} WLO price in USD
 */
async function getWLOPrice() {
  try {
    const now = Date.now();

    // Return cached price if still valid
    if (priceCache.wlo.price && (now - priceCache.wlo.timestamp) < CACHE_DURATION) {
      console.log(`🪙 Using cached WLO price: $${priceCache.wlo.price}`);
      return priceCache.wlo.price;
    }

    // Fetch from GeckoTerminal - WLO/XRP pool on XRPL
    // Pool address: WLO.rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY_XRP (without xrpl_ prefix in URL)
    const poolId = 'WLO.rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY_XRP';
    const response = await axios.get(`https://api.geckoterminal.com/api/v2/networks/xrpl/pools/${encodeURIComponent(poolId)}`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    const priceUsd = response.data?.data?.attributes?.base_token_price_usd;

    if (priceUsd) {
      const price = parseFloat(priceUsd);
      priceCache.wlo = { price, timestamp: now };
      console.log(`🪙 Fetched WLO price from GeckoTerminal: $${price}`);
      return price;
    }

    // Fallback to default if API fails
    console.warn('⚠️ Failed to fetch WLO price from GeckoTerminal, using default $0.00003');
    return 0.00003;
  } catch (error) {
    console.error('❌ Error fetching WLO price:', error.message);
    return 0.00003; // Default fallback based on current market price
  }
}

/**
 * Get both XRP and WLO prices
 * @returns {Promise<{xrp: number, wlo: number}>} Prices in USD
 */
async function getAllPrices() {
  const [xrp, wlo] = await Promise.all([
    getXRPPrice(),
    getWLOPrice()
  ]);

  return { xrp, wlo };
}

/**
 * Calculate token amount needed for a USD value
 * @param {number} usdAmount - Amount in USD
 * @param {string} token - Token symbol ('xrp' or 'wlo')
 * @returns {Promise<number>} Token amount needed
 */
async function calculateTokenAmount(usdAmount, token) {
  const prices = await getAllPrices();
  const price = prices[token.toLowerCase()];

  if (!price) {
    throw new Error(`Unknown token: ${token}`);
  }

  const amount = usdAmount / price;
  
  // Round XRP to 2 decimals, WLO to whole numbers
  if (token.toLowerCase() === 'xrp') {
    return Math.ceil(amount * 100) / 100; // Round up to 2 decimals
  } else {
    return Math.ceil(amount); // Round up to whole number
  }
}

/**
 * Clear price cache (useful for testing)
 */
function clearCache() {
  priceCache = {
    xrp: { price: null, timestamp: 0 },
    wlo: { price: null, timestamp: 0 }
  };
  console.log('🧹 Price cache cleared');
}

export {
  getXRPPrice,
  getWLOPrice,
  getAllPrices,
  calculateTokenAmount,
  clearCache
};

