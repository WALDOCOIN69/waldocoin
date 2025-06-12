// server.js

import express from "express";
const app = express();

app.get("/", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`✅ WALDO API running at http://localhost:${PORT}`);
});

