// server.js
import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("🧩 WALDO MINIMAL SANITY CHECK - CLEAN SLATE");

const app = express();
app.use(express.json());

app.get("/", (_, res) => {
  res.json({ status: "WALDO API BASELINE ✅" });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`✅ WALDO MINIMAL server running at http://localhost:${PORT}`);
});
