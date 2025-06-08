// checkRoutes.js
import fs from 'fs';
import path from 'path';

const ROUTES_DIR = './routes';
const SERVER_FILE = './server.js';

function scanRoutesDirForBadPaths(dir) {
  const files = fs.readdirSync(dir);
  let broken = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // 🚨 Detect malformed :param: usage in router.<method>() definitions
    const regex = /router\.(get|post|put|delete|patch|use)\s*\(\s*['"`]\/:[^'"`\/]+:[^'"`\/]*['"`]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      broken.push({ source: file, line: match[0], type: 'router.*()' });
    }
  }

  return broken;
}

function scanServerForBadSafeRegisters(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let broken = [];

  // 🚨 Detect malformed :param: usage in safeRegister() calls
  const regex = /safeRegister\(\s*['"`]\/:[^'"`\/]+:[^'"`\/]*['"`]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    broken.push({ source: 'server.js', line: match[0], type: 'safeRegister()' });
  }

  return broken;
}

const routeIssues = scanRoutesDirForBadPaths(ROUTES_DIR);
const serverIssues = scanServerForBadSafeRegisters(SERVER_FILE);

const allIssues = [...routeIssues, ...serverIssues];

if (allIssues.length === 0) {
  console.log("✅ No malformed route paths found!");
} else {
  console.log("❌ Found malformed route paths:");
  allIssues.forEach(({ source, line, type }) => {
    console.log(`- ${source} [${type}] ➜ ${line}`);
  });
  process.exit(1); // optional: fail the check
}
