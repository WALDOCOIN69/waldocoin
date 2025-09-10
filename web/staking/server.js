// Simple Express server to serve the staking page
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files
app.use(express.static(__dirname));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'WALDO Staking Page' });
});

app.listen(PORT, () => {
  console.log(`🏦 WALDO Staking page running on port ${PORT}`);
});
