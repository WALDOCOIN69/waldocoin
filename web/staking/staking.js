// WALDO Staking Widget JavaScript
console.log('🚀 External JavaScript file loading...');

// Test if basic JavaScript works
function testButton() {
  alert('JavaScript is working from external file!');
  console.log('✅ JavaScript test successful');
}

// Simple connect function
function stakeConnect() {
  alert('🔗 Connect button clicked!');
  console.log('🔗 Connect button clicked!');
}

// Simple trustline function
function stakeTrustline() {
  alert('➕ Add Trustline clicked!');
  console.log('➕ Add Trustline clicked!');
}

// Simple load info function
function stakeLoadInfo() {
  alert('📊 Load Info clicked!');
  console.log('📊 Load Info clicked!');
}

// Simple disconnect function
function stakeDisconnect() {
  alert('🔌 Disconnect clicked!');
  console.log('🔌 Disconnect clicked!');
}

// Simple stake functions
function createLongTermStake() {
  alert('🏦 Long-term stake clicked!');
  console.log('🏦 Long-term stake clicked!');
}

function createPerMemeStake() {
  alert('🎭 Per-meme stake clicked!');
  console.log('🎭 Per-meme stake clicked!');
}

// Simple max functions
function ltSetMax() {
  alert('⚡ Long-term Max clicked!');
  console.log('⚡ Long-term Max clicked!');
}

function pmSetMax() {
  alert('⚡ Per-meme Max clicked!');
  console.log('⚡ Per-meme Max clicked!');
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

console.log('✅ All functions defined and attached to window');
