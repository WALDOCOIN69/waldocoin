// minimal-server.js - Absolute minimal server for emergency deployment
import express from "express";

console.log('🚀 Starting absolute minimal server...');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('📦 Setting up CORS...');

// Simple CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Admin-Key');

  console.log(`📡 ${req.method} ${req.path} from ${req.get('origin') || 'unknown'}`);

  if (req.method === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight');
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
console.log('✅ Middleware configured');

// Health check endpoint
app.get("/api/health", (req, res) => {
  console.log('🏥 Health check requested');
  res.json({
    status: "OK",
    message: "Minimal server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

// Test endpoint
app.get("/api/test", (req, res) => {
  console.log('🧪 Test endpoint requested');
  res.json({
    success: true,
    message: "Test endpoint working",
    timestamp: new Date().toISOString()
  });
});

// Mock battle endpoints
app.get("/api/battle/current", (req, res) => {
  console.log('⚔️ Battle current requested');
  res.json({
    success: false,
    error: "No current battle",
    message: "Minimal server - battle system temporarily unavailable"
  });
});

app.get("/api/battle/history", (req, res) => {
  console.log('📜 Battle history requested');
  res.json({
    success: true,
    battles: [],
    message: "Minimal server - no battle history available"
  });
});

app.get("/api/battle/leaderboard", (req, res) => {
  console.log('🏆 Battle leaderboard requested');
  res.json({
    success: true,
    leaderboard: [],
    message: "Minimal server - no leaderboard data available"
  });
});

app.get("/api/config/public", (req, res) => {
  console.log('⚙️ Public config requested');
  res.json({
    success: true,
    config: {
      battleStartFee: 150000,  // ~4.5 XRP
      battleAcceptFee: 75000,  // ~2.25 XRP
      battleVoteFee: 30000     // ~0.9 XRP (20% of start fee)
    },
    message: "Updated battle fees - Start: 150k WLO (~4.5 XRP), Accept: 75k WLO (~2.25 XRP), Vote: 30k WLO (~0.9 XRP)"
  });
});

// Catch all other routes
app.get('*', (req, res) => {
  console.log(`❓ Unknown route requested: ${req.path}`);
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    message: "This endpoint is not available on the minimal server"
  });
});

// Start server
console.log(`🚀 Starting server on port ${PORT}...`);
app.listen(PORT, () => {
  console.log(`✅ Minimal server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📍 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🌐 Server ready for requests`);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

console.log('🎯 Minimal server setup complete');
