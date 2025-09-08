import express from 'express';
import { redis } from '../../redisClient.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const statusRaw = await redis.get('autodistribute:status');
    const eventsRaw = await redis.lRange('autodistribute:events', 0, 20);
    const status = statusRaw ? JSON.parse(statusRaw) : null;
    const events = (eventsRaw || []).map(e => { try { return JSON.parse(e); } catch { return e; } });
    res.json({ ok: true, status, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;

