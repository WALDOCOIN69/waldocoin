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

// Make functions globally available
window.testButton = testButton;
window.stakeConnect = stakeConnect;
window.stakeTrustline = stakeTrustline;
window.stakeLoadInfo = stakeLoadInfo;

console.log('✅ All functions defined and attached to window');
