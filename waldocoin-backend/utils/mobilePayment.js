/**
 * Universal Mobile-First Payment System
 * 
 * Provides consistent mobile-optimized payment flow across all WALDOCOIN systems
 * - No QR codes (deep links only)
 * - Device detection and optimization
 * - State recovery and error handling
 * - Consistent UX patterns
 */

console.log("🧩 Loaded: utils/mobilePayment.js");

/**
 * Create mobile-optimized payment modal
 * @param {Object} options - Payment modal configuration
 * @returns {Object} - Modal control functions
 */
export function createMobilePaymentModal(options) {
  const {
    uuid,
    next,
    title,
    amount,
    description = null,
    onSuccess,
    onFailure = null,
    onTimeout = null,
    baseURL = 'https://api.waldocoin.live'
  } = options;

  // Detect if user is on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const mobileLink = next?.always || `https://xumm.app/sign/${uuid}`;

  // Create modal element
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="background: #1a1a1a; border-radius: 20px; padding: 30px; max-width: 400px; width: 90%; text-align: center; border: 2px solid #25c2a0; box-shadow: 0 10px 30px rgba(37, 194, 160, 0.3);">
      <div style="margin-bottom: 20px;">
        <div style="font-size: 48px; margin-bottom: 10px;">💳</div>
        <h3 style="color: #25c2a0; margin: 0 0 10px 0; font-size: 24px;">${title}</h3>
        <p style="color: #fff; margin: 0; font-size: 18px; font-weight: bold;">${amount}</p>
        ${description ? `<p style="color: #ccc; margin: 10px 0 0 0; font-size: 14px;">${description}</p>` : ''}
      </div>
      
      <div style="background: linear-gradient(135deg, #25c2a0, #1a9d7c); padding: 20px; border-radius: 15px; margin-bottom: 20px;">
        <div style="color: #000; font-weight: bold; margin-bottom: 10px; font-size: 16px;">
          ${isMobile ? '📱 Tap to open Xaman' : '🔗 Click to open Xaman'}
        </div>
        <a href="${mobileLink}" ${isMobile ? '' : 'target="_blank"'} 
           style="display: block; background: #000; color: #25c2a0; padding: 15px 20px; border-radius: 12px; text-decoration: none; font-weight: bold; font-size: 18px;">
          🚀 Open Xaman Wallet
        </a>
      </div>
      
      <div style="color: #ccc; font-size: 14px; line-height: 1.4; margin-bottom: 15px;">
        ${isMobile 
          ? '• Tap the button above to open Xaman<br>• Sign the transaction to complete payment<br>• This window will close automatically' 
          : '• Click the button to open Xaman in a new tab<br>• Sign the transaction in Xaman<br>• Return here - payment will be detected automatically'
        }
      </div>
      
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 20px;">
        <div class="payment-spinner" style="width: 20px; height: 20px; border: 2px solid #333; border-top: 2px solid #25c2a0; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <span style="color: #25c2a0; font-size: 14px;">Waiting for payment...</span>
      </div>
    </div>
  `;

  // Add spinner animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // Add modal to page
  document.body.appendChild(modal);

  // Enhanced payment polling with state recovery
  let pollAttempts = 0;
  const maxPollAttempts = 300; // 10 minutes at 2-second intervals
  let pollInterval;

  const startPolling = () => {
    pollInterval = setInterval(async () => {
      try {
        pollAttempts++;
        const response = await fetch(`${baseURL}/api/payment/status/${uuid}`);
        const data = await response.json();

        if (data.success && data.signed === true) {
          clearInterval(pollInterval);
          modal.remove();
          style.remove();
          
          // Store successful payment for state recovery
          localStorage.setItem('waldocoin_last_payment', JSON.stringify({
            uuid,
            status: 'success',
            timestamp: Date.now(),
            type: title
          }));
          
          if (onSuccess) onSuccess();
        } else if (data.success && data.signed === false) {
          clearInterval(pollInterval);
          modal.remove();
          style.remove();
          
          // Store failed payment
          localStorage.setItem('waldocoin_last_payment', JSON.stringify({
            uuid,
            status: 'rejected',
            timestamp: Date.now(),
            type: title
          }));
          
          if (onFailure) onFailure();
        } else if (pollAttempts >= maxPollAttempts) {
          // Timeout reached
          clearInterval(pollInterval);
          modal.remove();
          style.remove();
          
          localStorage.setItem('waldocoin_last_payment', JSON.stringify({
            uuid,
            status: 'timeout',
            timestamp: Date.now(),
            type: title
          }));
          
          if (onTimeout) onTimeout();
        }
      } catch (e) {
        console.warn('Payment polling error:', e);
        // Continue polling on error, but track failures
        if (pollAttempts >= maxPollAttempts) {
          clearInterval(pollInterval);
          modal.remove();
          style.remove();
          if (onTimeout) onTimeout();
        }
      }
    }, 2000);
  };

  // Start polling
  startPolling();

  // Return control functions
  return {
    close: () => {
      if (pollInterval) clearInterval(pollInterval);
      if (modal.parentNode) modal.remove();
      if (style.parentNode) style.remove();
    },
    isOpen: () => document.body.contains(modal)
  };
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 */
export function showToast(message, type = 'info') {
  const colors = {
    success: '#25c2a0',
    error: '#e74c3c',
    warning: '#f39c12',
    info: '#3498db'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 15px 20px;
    border-radius: 10px;
    font-weight: bold;
    z-index: 10001;
    max-width: 300px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease-out;
  `;

  toast.textContent = message;

  // Add slide-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(toast);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
        if (style.parentNode) style.remove();
      }, 300);
    }
  }, 5000);

  // Add slide-out animation
  style.textContent += `
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
}

/**
 * Check for payment recovery on page load
 */
export function checkPaymentRecovery() {
  try {
    const lastPayment = localStorage.getItem('waldocoin_last_payment');
    if (lastPayment) {
      const payment = JSON.parse(lastPayment);
      const timeSince = Date.now() - payment.timestamp;
      
      // Only show recovery for recent payments (within 5 minutes)
      if (timeSince < 5 * 60 * 1000) {
        if (payment.status === 'success') {
          showToast(`✅ ${payment.type} payment completed successfully!`, "success");
        } else if (payment.status === 'timeout') {
          showToast(`⏰ Previous ${payment.type} payment timed out. Check Xaman for completion.`, "info");
        }
      }
      
      // Clean up old payment records
      if (timeSince > 10 * 60 * 1000) {
        localStorage.removeItem('waldocoin_last_payment');
      }
    }
  } catch (e) {
    console.warn('Payment recovery check failed:', e);
  }
}

/**
 * Handle wallet disconnection events
 */
export function handleWalletDisconnection() {
  // Listen for wallet disconnection events
  window.addEventListener('storage', (e) => {
    if (e.key === 'xummWallet' && !e.newValue) {
      // Wallet was disconnected
      showToast("Wallet disconnected. Please reconnect to continue.", "warning");
      
      // Clear any ongoing payment modals
      const existingModals = document.querySelectorAll('div[style*="position: fixed"]');
      existingModals.forEach(modal => {
        if (modal.innerHTML.includes('Xaman')) {
          modal.remove();
        }
      });
    }
  });
}

/**
 * Initialize mobile payment system
 * Call this on page load to set up recovery and disconnection handling
 */
export function initializeMobilePaymentSystem() {
  checkPaymentRecovery();
  handleWalletDisconnection();
  console.log('📱 Mobile payment system initialized');
}
