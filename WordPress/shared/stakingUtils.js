// shared/stakingUtils.js - Frontend staking utilities
// This file contains shared functions for staking widgets to reduce duplication

/**
 * Calculate maturity with buffer (matches backend logic)
 * @param {string|Date} endDate - End date of stake
 * @param {number} bufferMs - Buffer in milliseconds (default 60 seconds)
 * @returns {Object} - Maturity information
 */
function calculateMaturity(endDate, bufferMs = 60 * 1000) {
  const now = Date.now();
  const end = new Date(endDate).getTime();
  const timeRemaining = Math.max(0, end - now);
  
  return {
    isMatured: timeRemaining <= bufferMs,
    timeRemaining,
    daysRemaining: Math.ceil(timeRemaining / (24 * 60 * 60 * 1000)),
    endTimestamp: end,
    bufferMs
  };
}

/**
 * Format date for display
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} - Formatted date
 */
function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString();
  } catch (_) {
    return dateStr || '';
  }
}

/**
 * Format time for display
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} - Formatted time
 */
function formatTime(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

/**
 * Calculate accrued rewards (matches backend calculation)
 * @param {number} amount - Stake amount
 * @param {string|number} apy - APY percentage
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {number} - Accrued reward amount
 */
function calculateAccrued(amount, apy, startDate, endDate) {
  const now = Date.now();
  const st = +new Date(startDate || 0);
  const ed = +new Date(endDate || 0);
  if (!isFinite(st) || !isFinite(ed) || st <= 0 || ed <= 0) return 0;
  
  // Calculate as flat bonus percentage (not annualized APY)
  const rewardCalculation = amount * (parseFloat(String(apy).replace('%', '')) / 100);
  return Math.floor(rewardCalculation * 100) / 100; // Match backend rounding
}

/**
 * Setup countdown timer for staking widgets
 * @param {string} selector - CSS selector for countdown elements
 */
function setupCountdownTimer(selector = '.waldo-stake .countdown[data-end]') {
  if (window._stakeCountdownTimer) return;
  
  window._stakeCountdownTimer = setInterval(() => {
    document.querySelectorAll(selector).forEach(el => {
      const end = Number(el.dataset.end || 0);
      const totalDuration = Number(el.dataset.duration || 30);
      if (!end) return;
      
      const diff = Math.max(0, end - Date.now());
      const daysLeft = Math.ceil(diff / (24 * 60 * 60 * 1000));
      const bufferMs = 60 * 1000; // 60-second buffer
      
      // Remove existing color classes
      el.classList.remove('danger', 'warning', 'ready');
      
      // Color coding based on percentage of time remaining
      const percentRemaining = (daysLeft / totalDuration) * 100;
      if (diff <= bufferMs) {
        el.classList.add('ready');
        el.textContent = 'READY!';
      } else if (percentRemaining <= 25) {
        el.classList.add('danger');
      } else if (percentRemaining <= 50) {
        el.classList.add('warning');
      }
      
      if (diff > bufferMs) {
        if (diff <= 24 * 60 * 60 * 1000) {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          el.textContent = `${daysLeft}d`;
        }
      }
    });
  }, 1000);
}

/**
 * Filter stakes by maturity status
 * @param {Array} positions - Array of stake positions
 * @returns {Object} - Filtered stakes by status
 */
function filterStakesByMaturity(positions) {
  const now = Date.now();
  const bufferMs = 60 * 1000; // 60-second buffer to match backend
  
  const activeStakes = positions.filter(s => {
    if (s.status !== 'active') return false;
    const endMs = +new Date(s.endDate || Date.now());
    const timeRemaining = Math.max(0, endMs - now);
    return timeRemaining > bufferMs;
  });
  
  const readyStakes = positions.filter(s => {
    if (s.status !== 'active') return false;
    const endMs = +new Date(s.endDate || Date.now());
    const timeRemaining = Math.max(0, endMs - now);
    return timeRemaining <= bufferMs;
  });
  
  const redeemedStakes = positions.filter(s => 
    s.status === 'redeemed' || s.status === 'completed'
  );
  
  return { activeStakes, readyStakes, redeemedStakes };
}

/**
 * Validate wallet address
 * @param {string} wallet - Wallet address
 * @returns {boolean} - True if valid XRPL wallet
 */
function isValidWallet(wallet) {
  return wallet && typeof wallet === 'string' && wallet.startsWith('r') && wallet.length >= 25;
}

/**
 * Get API base URL with fallbacks
 * @returns {string} - API base URL
 */
function getApiBase() {
  return window.WALDO_API || 
         (window.parent && window.parent.WALDO_API) || 
         'https://waldocoin-backend-api.onrender.com';
}

/**
 * Make API request with error handling
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise} - API response
 */
async function apiRequest(endpoint, options = {}) {
  const API = getApiBase();
  const url = endpoint.startsWith('http') ? endpoint : `${API}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API request failed: ${url}`, error);
    throw error;
  }
}

// Export functions for use in staking widgets
if (typeof window !== 'undefined') {
  window.StakingUtils = {
    calculateMaturity,
    formatDate,
    formatTime,
    calculateAccrued,
    setupCountdownTimer,
    filterStakesByMaturity,
    isValidWallet,
    getApiBase,
    apiRequest
  };
}
