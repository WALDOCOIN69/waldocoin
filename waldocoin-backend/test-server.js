// test-server.js - Minimal server to test basic functionality
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration for WALDOCOIN subdomains
const allowedDomains = ["waldocoin.live", "waldo.live", "waldocoin.onrender.com"];
const corsOriginCheck = (origin) => {
  console.log(`🔍 CORS Check: origin="${origin}"`);

  if (!origin) {
    console.log('✅ CORS: No origin (curl/local) - ALLOWED');
    return true; // allow curl/local/file://
  }

  // Allow file:// protocol for local development
  if (origin.startsWith('file://')) {
    console.log('✅ CORS: file:// protocol - ALLOWED');
    return true;
  }

  // Allow localhost for development
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    console.log('✅ CORS: localhost - ALLOWED');
    return true;
  }

  try {
    const url = new URL(origin);
    console.log(`🔍 CORS: hostname="${url.hostname}"`);
    const allowed = allowedDomains.some(domain => {
      const exactMatch = url.hostname === domain;
      const subdomainMatch = url.hostname.endsWith('.' + domain);
      console.log(`🔍 CORS: checking domain="${domain}" exact=${exactMatch} subdomain=${subdomainMatch}`);
      return exactMatch || subdomainMatch;
    });
    console.log(`${allowed ? '✅' : '❌'} CORS: Final decision - ${allowed ? 'ALLOWED' : 'DENIED'}`);
    return allowed;
  } catch (e) {
    console.log('❌ CORS: URL parsing error - DENIED', e.message);
    return false;
  }
};

app.use(cors({
  origin: (origin, cb) => {
    const allowed = corsOriginCheck(origin);
    console.log(`🔍 CORS: origin="${origin}" → ${allowed ? 'ALLOWED' : 'DENIED'}`);
    cb(null, allowed);
  },
  credentials: false,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Key']
}));

// Ensure preflight (OPTIONS) also returns proper CORS headers
app.options(/.*/, cors({
  origin: (origin, cb) => {
    const allowed = corsOriginCheck(origin);
    console.log(`🔍 OPTIONS CORS: origin="${origin}" → ${allowed ? 'ALLOWED' : 'DENIED'}`);
    cb(null, allowed);
  },
  credentials: false,
}));

app.use(express.json());

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
app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
