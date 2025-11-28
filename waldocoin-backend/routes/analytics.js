import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { redis } from "../redisClient.js"; // ✅ Import Redis client
import {
  MemeGeneration,
  UserSession,
  TemplatePerformance,
  ConversionEvent,
  FeatureUsage
} from '../models/Analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// ✅ Enable strict route validation

console.log("🧩 Loaded:routes/analytics.js");

// 📌 Wallet Analytics from Redis
router.get("/wallet/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const key = `wallet:${address}:analytics`;
    const data = await redis.hGetAll(key);
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No analytics found for wallet." });
    }
    res.json({ address, ...data });
  } catch (err) {
    console.error("❌ Wallet analytics error:", err);
    res.status(500).json({ error: "Failed to load wallet analytics." });
  }
});

// ⚔️ Battle Stats from Redis
router.get("/battles", async (req, res) => {
  try {
    const data = await redis.hGetAll("stats:battles");
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No battle stats found." });
    }
    res.json(data);
  } catch (err) {
    console.error("❌ Battle stats error:", err);
    res.status(500).json({ error: "Failed to load battle stats." });
  }
});

// 🎁 Airdrop Stats from Redis
router.get("/airdrops", async (req, res) => {
  try {
    const data = await redis.hGetAll("stats:airdrops");
    if (!data || Object.keys(data).length === 0) {
      return res.status(404).json({ error: "No airdrop stats found." });
    }
    res.json(data);
  } catch (err) {
    console.error("❌ Airdrop stats error:", err);
    res.status(500).json({ error: "Failed to load airdrop stats." });
  }
});

// 🎨 MEMEOLOGY ANALYTICS

// GET /api/analytics/memeology/dashboard - Main memeology analytics dashboard
router.get('/memeology/dashboard', async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;

    // Calculate date range
    const now = new Date();
    const startDate = new Date();
    if (timeRange === '24h') startDate.setHours(now.getHours() - 24);
    else if (timeRange === '7d') startDate.setDate(now.getDate() - 7);
    else if (timeRange === '30d') startDate.setDate(now.getDate() - 30);
    else if (timeRange === '90d') startDate.setDate(now.getDate() - 90);

    // Parallel queries for performance
    const [
      totalMemes,
      totalSessions,
      totalConversions,
      topTemplates,
      tierBreakdown,
      generationModeBreakdown,
      recentActivity
    ] = await Promise.all([
      // Total memes generated
      MemeGeneration.countDocuments({ createdAt: { $gte: startDate } }),

      // Total sessions
      UserSession.countDocuments({ startedAt: { $gte: startDate } }),

      // Total conversions
      ConversionEvent.countDocuments({ createdAt: { $gte: startDate } }),

      // Top 10 templates
      TemplatePerformance.find()
        .sort({ totalGenerations: -1 })
        .limit(10)
        .select('templateName totalGenerations totalDownloads downloadRate'),

      // Tier breakdown
      MemeGeneration.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$tier', count: { $sum: 1 } } }
      ]),

      // Generation mode breakdown
      MemeGeneration.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$generationMode', count: { $sum: 1 } } }
      ]),

      // Recent activity (last 24 hours by hour)
      MemeGeneration.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Calculate conversion rate
    const conversionRate = totalSessions > 0
      ? ((totalConversions / totalSessions) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      timeRange,
      summary: {
        totalMemes,
        totalSessions,
        totalConversions,
        conversionRate: `${conversionRate}%`,
        avgMemesPerSession: totalSessions > 0
          ? (totalMemes / totalSessions).toFixed(2)
          : 0
      },
      topTemplates,
      tierBreakdown,
      generationModeBreakdown,
      recentActivity
    });
  } catch (error) {
    console.error('Error fetching memeology dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/memeology/trending - Get trending templates
router.get('/memeology/trending', async (req, res) => {
  try {
    const { limit = 20, timeRange = '24h' } = req.query;

    const now = new Date();
    const startDate = new Date();
    if (timeRange === '24h') startDate.setHours(now.getHours() - 24);
    else if (timeRange === '7d') startDate.setDate(now.getDate() - 7);

    // Get templates with most recent activity
    const trending = await MemeGeneration.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$templateId',
          templateName: { $first: '$templateName' },
          count: { $sum: 1 },
          downloads: { $sum: { $cond: ['$wasDownloaded', 1, 0] } },
          shares: { $sum: { $cond: ['$wasShared', 1, 0] } }
        }
      },
      {
        $addFields: {
          trendingScore: {
            $add: [
              '$count',
              { $multiply: ['$downloads', 2] },
              { $multiply: ['$shares', 3] }
            ]
          }
        }
      },
      { $sort: { trendingScore: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      success: true,
      timeRange,
      trending
    });
  } catch (error) {
    console.error('Error fetching trending templates:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

