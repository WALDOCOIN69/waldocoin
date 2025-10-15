// test-server.js - Ultra minimal server for emergency deployment
import express from "express";

console.log('🚀 Starting ultra minimal server...');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('📦 Setting up basic middleware...');

// Ultra simple CORS - allow all origins for now
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
console.log('✅ Middleware configured');

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Test server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

// Basic test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Test endpoint working",
    timestamp: new Date().toISOString()
  });
});

// Mock battle endpoints for testing
app.get("/api/battle/current", (req, res) => {
  res.json({
    success: false,
    error: "No current battle",
    message: "Test server - battle system temporarily unavailable"
  });
});

app.get("/api/battle/history", (req, res) => {
  res.json({
    success: true,
    battles: [],
    message: "Test server - no battle history available"
  });
});

app.get("/api/battle/leaderboard", (req, res) => {
  res.json({
    success: true,
    leaderboard: [],
    message: "Test server - no leaderboard data available"
  });
});

app.get("/api/config/public", (req, res) => {
  res.json({
    success: true,
    config: {
      battleStartFee: 100,
      battleAcceptFee: 50,
      battleVoteFee: 5
    },
    message: "Test server - mock configuration"
  });
});

// Start server
console.log('🚀 Starting server on port', PORT);
app.listen(PORT, () => {
  console.log(`✅ Ultra minimal server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📍 Test endpoint: http://localhost:${PORT}/api/test`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
