import express from "express";
import loginRoutes from "./routes/login.js";
const app = express();

app.use("/api/login", loginRoutes);

app.get("/", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`✅ WALDO API running at http://localhost:${PORT}`);
});
