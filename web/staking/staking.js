// WALDO Staking Widget JavaScript
console.log('🚀 External JavaScript file loading...');

// Configuration
const API = window.WALDO_API || 'https://waldocoin-backend-api.onrender.com';
const ISSUER = 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY';
const CURRENCY = 'WLO';
let WALLET = '';
let CURRENT_BAL = 0;

console.log('📡 API URL:', API);

// Test if basic JavaScript works
function testButton() {
  alert('JavaScript is working from external file!');
  console.log('✅ JavaScript test successful');
}

// Real connect function
function stakeConnect() {
  console.log('🔗 Connect button clicked!');
  try {
    // Update UI to show connected status
    const statusEl = document.getElementById('stakeConnStatus');
    const disconnectBtn = document.getElementById('btnStakeDisconnect');

    if (statusEl) statusEl.textContent = 'Connected (manual)';
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';

    // Get wallet from input field
    const walletInput = document.getElementById('stakeWallet');
    if (walletInput && walletInput.value.trim()) {
      WALLET = walletInput.value.trim();
      stakeLoadInfo(); // Auto-load info if wallet is entered
    }

    alert('✅ Connected! Enter your wallet address and click Load Info.');
  } catch (error) {
    console.error('❌ Connect error:', error);
    alert('Connect error: ' + error.message);
  }
}

// Real trustline function
async function stakeTrustline() {
  console.log('➕ Add Trustline clicked!');
  try {
    const response = await fetch(`${API}/api/xrpl/trustline/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();
    console.log('Trustline API response:', result);

    if (!result.success) {
      throw new Error(result.error || 'Trustline creation failed');
    }

    // Show XUMM modal with QR code
    showXummModal('Add WALDO Trustline', result);

  } catch (error) {
    console.error('❌ Trustline error:', error);
    alert('Trustline error: ' + error.message);
  }
}

// Real load info function
async function stakeLoadInfo() {
  console.log('📊 Load Info clicked!');
  try {
    const walletInput = document.getElementById('stakeWallet');
    const wallet = walletInput ? walletInput.value.trim() : '';

    if (!wallet || !wallet.startsWith('r')) {
      alert('Please enter a valid XRPL wallet address (starts with r)');
      return;
    }

    WALLET = wallet;
    console.log('Loading info for wallet:', WALLET);

    // Check trustline status
    const tlResponse = await fetch(`${API}/api/xrpl/trustline/status?account=${encodeURIComponent(WALLET)}`);
    const tlResult = await tlResponse.json();

    const tlStatusEl = document.getElementById('stakeTlStatus');
    if (tlStatusEl) {
      tlStatusEl.textContent = `Trustline: ${tlResult.trustline ? 'Yes' : 'No'}`;
    }

    // Get staking info
    const stakingResponse = await fetch(`${API}/api/staking/info/${encodeURIComponent(WALLET)}`);
    const stakingResult = await stakingResponse.json();

    if (stakingResult.success) {
      // Update balance
      CURRENT_BAL = (stakingResult.userInfo && typeof stakingResult.userInfo.currentBalance === 'number')
        ? stakingResult.userInfo.currentBalance : 0;

      const balStr = Math.floor(CURRENT_BAL).toLocaleString();
      const ltBalEl = document.getElementById('ltBal');
      const pmBalEl = document.getElementById('pmBal');

      if (ltBalEl) ltBalEl.textContent = balStr;
      if (pmBalEl) pmBalEl.textContent = balStr;

      // Update connection status
      const statusEl = document.getElementById('stakeConnStatus');
      if (statusEl) {
        statusEl.textContent = `Wallet: ${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`;
      }

      alert(`✅ Wallet loaded! Balance: ${balStr} WLO`);
    } else {
      throw new Error(stakingResult.error || 'Failed to load wallet info');
    }

  } catch (error) {
    console.error('❌ Load info error:', error);
    alert('Load info error: ' + error.message);
  }
}

// XUMM Modal functions
function showXummModal(title, payload) {
  const modal = document.getElementById('xummModalStake');
  const titleEl = document.getElementById('xummTitleStake');
  const qrImg = document.getElementById('xummQrStake');

  if (titleEl) titleEl.textContent = title || 'Xaman';
  if (modal) modal.style.display = 'block';

  // Show QR code
  if (qrImg && payload.refs && payload.refs.qr_png) {
    qrImg.src = payload.refs.qr_png;
    qrImg.style.display = 'block';
  }

  console.log('XUMM Modal opened:', payload);
}

function xummCloseStake() {
  const modal = document.getElementById('xummModalStake');
  if (modal) modal.style.display = 'none';
}

// Real disconnect function
function stakeDisconnect() {
  console.log('🔌 Disconnect clicked!');
  WALLET = '';

  const walletInput = document.getElementById('stakeWallet');
  const statusEl = document.getElementById('stakeConnStatus');
  const disconnectBtn = document.getElementById('btnStakeDisconnect');
  const tlStatusEl = document.getElementById('stakeTlStatus');

  if (walletInput) walletInput.value = '';
  if (statusEl) statusEl.textContent = 'Not connected';
  if (disconnectBtn) disconnectBtn.style.display = 'none';
  if (tlStatusEl) tlStatusEl.textContent = 'Trustline: —';

  alert('🔌 Disconnected');
}

// Real max functions
function ltSetMax() {
  console.log('⚡ Long-term Max clicked!');
  if (typeof CURRENT_BAL === 'number' && CURRENT_BAL > 0) {
    const amountInput = document.getElementById('ltAmount');
    if (amountInput) {
      amountInput.value = Math.floor(CURRENT_BAL);
      alert(`⚡ Set to maximum: ${Math.floor(CURRENT_BAL)} WLO`);
    }
  } else {
    alert('Load your wallet info first to see balance');
  }
}

function pmSetMax() {
  console.log('⚡ Per-meme Max clicked!');
  if (typeof CURRENT_BAL === 'number' && CURRENT_BAL > 0) {
    const amountInput = document.getElementById('pmAmount');
    if (amountInput) {
      amountInput.value = Math.floor(CURRENT_BAL);
      alert(`⚡ Set to maximum: ${Math.floor(CURRENT_BAL)} WLO`);
    }
  } else {
    alert('Load your wallet info first to see balance');
  }
}

// Real stake functions
async function createLongTermStake() {
  console.log('🏦 Long-term stake clicked!');
  try {
    if (!WALLET) {
      alert('Please connect and load your wallet info first');
      return;
    }

    const amountInput = document.getElementById('ltAmount');
    const durationSelect = document.getElementById('ltDuration');
    const msgEl = document.getElementById('ltMsg');

    const amount = amountInput ? parseFloat(amountInput.value || '0') : 0;
    const duration = durationSelect ? parseInt(durationSelect.value || '0') : 0;

    if (!amount || !duration) {
      if (msgEl) msgEl.textContent = 'Enter amount and select duration';
      alert('Please enter amount and select duration');
      return;
    }

    if (msgEl) msgEl.textContent = 'Creating stake...';

    const response = await fetch(`${API}/api/staking/long-term`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET, amount: amount, duration: duration })
    });

    const result = await response.json();

    if (result.success) {
      if (msgEl) msgEl.textContent = `✅ Long-term stake created! Expected reward: ${result.stakeData.expectedReward} WALDO`;
      alert(`✅ Long-term stake created! Expected reward: ${result.stakeData.expectedReward} WALDO`);
      // Reload wallet info
      stakeLoadInfo();
    } else {
      throw new Error(result.error || 'Stake creation failed');
    }

  } catch (error) {
    console.error('❌ Long-term stake error:', error);
    const msgEl = document.getElementById('ltMsg');
    if (msgEl) msgEl.textContent = 'Error: ' + error.message;
    alert('Stake error: ' + error.message);
  }
}

async function createPerMemeStake() {
  console.log('🎭 Per-meme stake clicked!');
  try {
    if (!WALLET) {
      alert('Please connect and load your wallet info first');
      return;
    }

    const amountInput = document.getElementById('pmAmount');
    const memeIdInput = document.getElementById('pmMemeId');
    const msgEl = document.getElementById('pmMsg');

    const amount = amountInput ? parseFloat(amountInput.value || '0') : 0;
    const memeId = memeIdInput ? memeIdInput.value.trim() : '';

    if (!amount || !memeId) {
      if (msgEl) msgEl.textContent = 'Enter amount and meme ID';
      alert('Please enter amount and meme ID');
      return;
    }

    if (msgEl) msgEl.textContent = 'Creating per-meme stake...';

    const response = await fetch(`${API}/api/staking/per-meme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: WALLET, amount: amount, memeId: memeId })
    });

    const result = await response.json();

    if (result.success) {
      if (msgEl) msgEl.textContent = `✅ Per-meme stake created! Total reward: ${result.stakeData.totalReward} WALDO`;
      alert(`✅ Per-meme stake created! Total reward: ${result.stakeData.totalReward} WALDO`);
      // Reload wallet info
      stakeLoadInfo();
    } else {
      throw new Error(result.error || 'Stake creation failed');
    }

  } catch (error) {
    console.error('❌ Per-meme stake error:', error);
    const msgEl = document.getElementById('pmMsg');
    if (msgEl) msgEl.textContent = 'Error: ' + error.message;
    alert('Stake error: ' + error.message);
  }
}

// Make functions globally available
window.testButton = testButton;
window.stakeConnect = stakeConnect;
window.stakeTrustline = stakeTrustline;
window.stakeLoadInfo = stakeLoadInfo;
window.stakeDisconnect = stakeDisconnect;
window.createLongTermStake = createLongTermStake;
window.createPerMemeStake = createPerMemeStake;
window.ltSetMax = ltSetMax;
window.pmSetMax = pmSetMax;
window.xummCloseStake = xummCloseStake;

console.log('✅ All functions defined and attached to window');
console.log('🎯 WALDO Staking Widget ready! API:', API);
