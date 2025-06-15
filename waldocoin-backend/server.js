import express from "express";
import dotenv from "dotenv";
dotenv.config();

console.log("🧩 WALDO SANITY RESTORE: login + claim.js");

const app = express();
app.use(express.json());

// ✅ Only testing login and claim routes
import loginRoutes from "./routes/login.js";
import claimRoutes from "./routes/claim.js";

app.use("/api/login", loginRoutes);
app.use("/api/claim", claimRoutes);

app.get("/", (_, res) => {
  res.json({ status: "WALDO LOGIN + CLAIM TEST ✅" });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`✅ WALDO login + claim test server running at http://localhost:${PORT}`);
});

