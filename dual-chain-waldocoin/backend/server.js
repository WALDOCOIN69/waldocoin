// 🚀 WALDOCOIN DUAL-CHAIN BACKEND SERVER

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from 'redis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// Import chain wallets
import { XRPLWallet } from '../chains/xrpl/wallet/xrplWallet.js';
import { SolanaWallet } from '../chains/solana/wallet/solanaWallet.js';

// Import routes
import presaleRoutes from './routes/presale.js';
import walletRoutes from './routes/wallet.js';
import rewardsRoutes from './routes/rewards.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ===== MIDDLEWARE =====
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== REDIS CONNECTION =====
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

await redis.connect();

// ===== RATE LIMITING =====
const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_waldocoin',
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000 || 900, // 15 minutes
});

app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({
      success: false,
      error: 'Too many requests',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000)
    });
  }
});

// ===== BLOCKCHAIN WALLET INITIALIZATION =====
const xrplWallet = new XRPLWallet({
  nodeUrl: process.env.XRPL_NODE || 'wss://xrplcluster.com',
  distributorSecret: process.env.XRPL_DISTRIBUTOR_SECRET,
  issuer: process.env.XRPL_WALDO_ISSUER
});

const solanaWallet = new SolanaWallet({
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  distributorSecret: process.env.SOLANA_DISTRIBUTOR_SECRET,
  waldoMint: process.env.SOLANA_WALDO_MINT
});

// Connect to blockchains
await xrplWallet.connect();
await solanaWallet.connect();

// Make wallets available to routes
app.locals.xrplWallet = xrplWallet;
app.locals.solanaWallet = solanaWallet;
app.locals.redis = redis;

// ===== HEALTH CHECK =====
app.get('/health', async (req, res) => {
  try {
    // Test Redis connection
    await redis.ping();

    // Test blockchain connections
    const xrplStatus = await xrplWallet.connect();
    const solanaStatus = await solanaWallet.connect();

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        redis: 'connected',
        xrpl: xrplStatus.success ? 'connected' : 'error',
        solana: solanaStatus.success ? 'connected' : 'error'
      },
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== API ROUTES =====
app.use('/api/presale', presaleRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);

// ===== ROOT ENDPOINT =====
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 WALDOCOIN Dual-Chain API',
    version: '1.0.0',
    chains: ['XRPL', 'Solana'],
    endpoints: {
      health: '/health',
      presale: '/api/presale',
      wallet: '/api/wallet',
      rewards: '/api/rewards',
      admin: '/api/admin',
      stats: '/api/stats'
    },
    documentation: 'https://docs.waldocoin.live'
  });
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    timestamp: new Date().toISOString()
  });
});

// ===== 404 HANDLER =====
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');

  try {
    await xrplWallet.disconnect();
    await solanaWallet.connection.close?.();
    await redis.disconnect();
    console.log('✅ All connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');

  try {
    await xrplWallet.disconnect();
    await solanaWallet.connection.close?.();
    await redis.disconnect();
    console.log('✅ All connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 WALDOCOIN Dual-Chain API running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 XRPL Node: ${process.env.XRPL_NODE || 'wss://xrplcluster.com'}`);
  console.log(`⚡ Solana RPC: ${process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'}`);
  console.log(`📊 Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
});

export { app, redis, xrplWallet, solanaWallet };
