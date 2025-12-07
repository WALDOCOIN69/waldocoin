// checkRoutes.js - lightweight health & core-route checker for WALDO backend
// Run via: npm run check:routes

import "dotenv/config";

const PORT = process.env.PORT || 5050;
const BASE_URL = `http://localhost:${PORT}`;

	const REQUIRED_ENDPOINTS = [
		"/api/health",
		"/api/routes",
		"/api/memeology/templates/imgflip",
		"/api/memeology/community/gallery",
		"/api/battle/leaderboard",
		"/api/battle/history",
		"/api/marketplace/stats",
	];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ping(path) {
  const url = `${BASE_URL}${path}`;
  console.log(`\n➡️  Checking ${url}`);

  try {
    const res = await fetch(url, { method: "GET" });
    const status = res.status;

    if (!res.ok) {
      console.error(`❌ ${path} responded with HTTP ${status}`);
      return { ok: false, status };
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      console.log(`✅ ${path} OK`, {
        status,
        success: json.success,
        apiStatus: json.status,
        error: json.error,
      });
    } else {
      const text = await res.text();
      console.log(`✅ ${path} OK (non-JSON)`, { status, preview: text.slice(0, 120) });
    }

    return { ok: true, status };
  } catch (err) {
    console.error(`❌ Error calling ${path}:`, err.message || String(err));
    return { ok: false, error: err };
  }
}

async function main() {
  console.log("🚀 WALDO route check starting...");
  console.log(`🌐 Target base URL: ${BASE_URL}`);

  // Importing server.js boots the full WALDO backend in this process
  console.log("🔧 Booting WALDO backend (via server.js)...");
  await import("./server.js");

  // Give the server a moment to finish async startup
  await delay(5000);

  let failures = 0;

  for (const path of REQUIRED_ENDPOINTS) {
    const result = await ping(path);
    if (!result.ok) failures += 1;
  }

  if (failures > 0) {
    console.error(`\n❌ Route check failed: ${failures} endpoint(s) reported problems.`);
    process.exit(1);
  }

  console.log("\n✅ All core WALDO routes responded successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ checkRoutes.js fatal error:", err);
  process.exit(1);
});

