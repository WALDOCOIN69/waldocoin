// waldocoin-backend/routes/adminsecurity.js
import express from "express";
const router = express.Router();

router.get("/ping", (req, res) => {
  res.json({ status: "adminsecurity route is live" });
});

export default router;

