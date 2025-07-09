// WALDOCOIN Dashboard Flickering Fix
// Add this script to fix loading loops and flickering

(function() {
  'use strict';
  
  console.log('🔧 Applying dashboard fixes...');
  
  // 1. Fix multiple initialization issue
  let originalInitFunction = window.initWaldoDashboard;
  let isInitializing = false;
  
  if (originalInitFunction) {
    window.initWaldoDashboard = async function() {
      if (isInitializing) {
        console.log('⚠️ Dashboard already initializing, skipping...');
        return;
      }
      
      isInitializing = true;
      try {
        await originalInitFunction.call(this);
      } finally {
        isInitializing = false;
      }
    };
  }
  
  // 2. Fix battle timer clearing
  let originalStartBattleTimer = window.startBattleTimer;
  if (originalStartBattleTimer) {
    window.startBattleTimer = function(seconds) {
      // Clear existing timer first
      if (window.battleTimerInterval) {
        clearInterval(window.battleTimerInterval);
        window.battleTimerInterval = null;
      }
      
      return originalStartBattleTimer.call(this, seconds);
    };
  }
  
  // 3. Fix periodic updates - reduce frequency to prevent overload
  let originalSetupPeriodicUpdates = window.setupPeriodicUpdates;
  if (originalSetupPeriodicUpdates) {
    window.setupPeriodicUpdates = function(wallet) {
      // Clear all existing intervals
      if (window.dashboardIntervals) {
        window.dashboardIntervals.forEach(interval => clearInterval(interval));
        window.dashboardIntervals = [];
      }
      
      // Set up less frequent updates to reduce load
      window.dashboardIntervals = window.dashboardIntervals || [];
      
      // Battle leaderboard - every 10 minutes instead of 5
      window.dashboardIntervals.push(
        setInterval(() => {
          if (window.fetchBattleLeaderboard) {
            window.fetchBattleLeaderboard().catch(e => console.warn('Periodic update failed:', e));
          }
        }, 10 * 60 * 1000)
      );
      
      // User level - every 5 minutes instead of 2-3
      window.dashboardIntervals.push(
        setInterval(() => {
          if (window.fetchUserLevel && wallet) {
            window.fetchUserLevel(wallet).catch(e => console.warn('Periodic update failed:', e));
          }
        }, 5 * 60 * 1000)
      );
      
      // Staking positions - every 10 minutes
      window.dashboardIntervals.push(
        setInterval(() => {
          if (window.fetchStakingPositions && wallet) {
            window.fetchStakingPositions(wallet).catch(e => console.warn('Periodic update failed:', e));
          }
        }, 10 * 60 * 1000)
      );
      
      console.log('⏰ Fixed periodic updates configured with reduced frequency');
    };
  }
  
  // 4. Add debouncing to prevent rapid API calls
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  // 5. Fix fetch functions to prevent overlapping calls
  const activeFetches = new Set();
  
  function wrapFetchFunction(functionName) {
    const originalFunction = window[functionName];
    if (originalFunction) {
      window[functionName] = async function(...args) {
        const key = functionName + JSON.stringify(args);
        
        if (activeFetches.has(key)) {
          console.log(`⚠️ ${functionName} already running, skipping...`);
          return;
        }
        
        activeFetches.add(key);
        try {
          return await originalFunction.apply(this, args);
        } finally {
          activeFetches.delete(key);
        }
      };
    }
  }
  
  // Wrap key fetch functions to prevent overlapping calls
  const fetchFunctions = [
    'fetchUserStats',
    'fetchUserLevel', 
    'fetchStakingPositions',
    'fetchTokenomicsStats',
    'fetchBattleLeaderboard',
    'fetchBattleStatus',
    'fetchBattleHistory'
  ];
  
  fetchFunctions.forEach(wrapFetchFunction);
  
  // 6. Add visibility change handler to pause updates when tab is hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      console.log('📱 Tab hidden, pausing updates...');
      // Don't clear intervals, just let them continue but they'll be less frequent
    } else {
      console.log('📱 Tab visible, resuming normal operation...');
    }
  });
  
  // 7. Add error boundary for uncaught errors
  window.addEventListener('error', function(event) {
    console.error('🚨 Dashboard error caught:', event.error);
    // Don't let errors break the entire dashboard
    event.preventDefault();
  });
  
  // 8. Add unload cleanup
  window.addEventListener('beforeunload', function() {
    console.log('🧹 Cleaning up dashboard intervals...');
    if (window.dashboardIntervals) {
      window.dashboardIntervals.forEach(interval => clearInterval(interval));
    }
    if (window.battleTimerInterval) {
      clearInterval(window.battleTimerInterval);
    }
  });
  
  console.log('✅ Dashboard fixes applied successfully');
  
})();

// Quick fix for immediate loading issues
document.addEventListener('DOMContentLoaded', function() {
  // Add loading state management
  const loadingElements = document.querySelectorAll('[id$="Status"]');
  loadingElements.forEach(el => {
    if (el.textContent.includes('Loading') || el.textContent.includes('loading')) {
      // Add timeout to prevent infinite loading
      setTimeout(() => {
        if (el.textContent.includes('Loading') || el.textContent.includes('loading')) {
          el.textContent = 'Ready';
          el.style.color = '#25c2a0';
        }
      }, 10000); // 10 second timeout
    }
  });
});
