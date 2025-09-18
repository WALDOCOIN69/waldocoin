// Test script to verify stake date calculations
console.log('=== STAKE DATE CALCULATION TEST ===');

// Test 1: 2-minute test stake
const minutesToMaturity = 2;
const startDate = new Date();
const endDate = new Date(Date.now() + (minutesToMaturity * 60 * 1000));

console.log('\n--- 2-Minute Test Stake ---');
console.log('Start Date:', startDate.toISOString());
console.log('End Date:', endDate.toISOString());
console.log('Minutes to maturity:', minutesToMaturity);
console.log('Milliseconds to maturity:', minutesToMaturity * 60 * 1000);

// Test 2: Check maturity calculation
const now = Date.now();
const endMs = endDate.getTime();
const timeRemaining = Math.max(0, endMs - now);
const bufferMs = 60 * 1000; // 60 seconds
const mature = timeRemaining <= bufferMs;

console.log('\n--- Maturity Check ---');
console.log('Current time:', new Date(now).toISOString());
console.log('End time:', new Date(endMs).toISOString());
console.log('Time remaining (ms):', timeRemaining);
console.log('Time remaining (seconds):', Math.ceil(timeRemaining / 1000));
console.log('Buffer (ms):', bufferMs);
console.log('Is mature (within buffer):', mature);

// Test 3: Already mature stake
const matureStartDate = new Date(Date.now() - (35 * 24 * 60 * 60 * 1000)); // 35 days ago
const matureEndDate = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));   // 5 days ago

console.log('\n--- Already Mature Stake ---');
console.log('Start Date:', matureStartDate.toISOString());
console.log('End Date:', matureEndDate.toISOString());

const matureEndMs = matureEndDate.getTime();
const matureTimeRemaining = Math.max(0, matureEndMs - now);
const matureMature = matureTimeRemaining <= bufferMs;

console.log('Time remaining (ms):', matureTimeRemaining);
console.log('Is mature:', matureMature);
console.log('Days overdue:', Math.floor((now - matureEndMs) / (24 * 60 * 60 * 1000)));

// Test 4: Simulate waiting 2 minutes
console.log('\n--- Simulation: After 2 minutes ---');
const futureTime = now + (2 * 60 * 1000) + (30 * 1000); // 2 minutes 30 seconds later
const futureTimeRemaining = Math.max(0, endMs - futureTime);
const futureMature = futureTimeRemaining <= bufferMs;

console.log('Future time:', new Date(futureTime).toISOString());
console.log('Time remaining (ms):', futureTimeRemaining);
console.log('Time remaining (seconds):', Math.ceil(futureTimeRemaining / 1000));
console.log('Would be mature:', futureMature);

console.log('\n=== TEST COMPLETE ===');
