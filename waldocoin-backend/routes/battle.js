import express from 'express';

// Import battle sub-routes (new standardized system)
import managementRouter from './battle/management.js';
import startRouter from './battle/start.js';
import acceptRouter from './battle/accept.js';
import voteRouter from './battle/vote.js';
import resultsRouter from './battle/results.js';
import payoutRouter from './battle/payout.js';
import leaderboardRouter from './battle/leaderboard.js';
import currentRouter from './battle/current.js';

const router = express.Router();

console.log("⚔️ Loaded: routes/battle.js (Standardized Battle System)");

// Mount standardized battle sub-routes
router.use('/management', managementRouter);
router.use('/start', startRouter);
router.use('/accept', acceptRouter);
router.use('/vote', voteRouter);
router.use('/results', resultsRouter);
router.use('/payout', payoutRouter);
router.use('/leaderboard', leaderboardRouter);
router.use('/current', currentRouter);

// Legacy endpoints removed - all functionality moved to dedicated sub-routes
// This prevents conflicts and ensures consistent data handling

export default router;
