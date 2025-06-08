// utils/validateRoutes.js
import fs from "fs";
import path from "path";
import { parse } from "path-to-regexp";

const ROUTES_DIR = "./routes";

export function validateRoutes() {
  const files = fs.readdirSync(ROUTES_DIR);
  const issues = [];

  for (const file of files) {
    const filePath = path.join(ROUTES_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");

    const routeRegex = /router\.(get|post|put|delete|patch)\s*\(\s*['"`](\/[^'"`]+)['"`]/g;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      const routePath = match[2];
      try {
        parse(routePath);
      } catch (err) {
        issues.push({ file, routePath, error: err.message });
      }
    }
  }

  if (issues.length === 0) {
    console.log("✅ All route patterns are valid.");
  } else {
    console.log("❌ Found broken route patterns:");
    issues.forEach((r) =>
      console.error(`- ${r.file} ➜ ${r.routePath} (${r.error})`)
    );
    process.exit(1);
  }
}
