import express from "express";

const app = express();

app.get("/", (_, res) => res.json({ status: "✅ WALDO API is BAREBONES clean" }));

app.listen(5050, () => console.log("✅ Minimal server running"));

