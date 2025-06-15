import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("🧩 WALDO SANITY RESTORE: login.js only");

const app = express();
app.use(express.json());

// ✅ Just login route for now
import loginRoutes from "./routes/login.js";
app.use("/api/login", loginRoutes);

app.get("/", (_, res) => {
  res.json({ status: "WALDO LOGIN TEST ✅" });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`✅ WALDO login test server running at http://localhost:${PORT}`);
});
