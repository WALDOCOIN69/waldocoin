import express from "express";
const router = express.Router();
router.get("/end-date", (req, res) => {
  res.json({ endDate: new Date(Date.now() + 3 * 86400000).toISOString() });
});
export default router;
