import fs from 'fs';
import path from 'path';

const ROUTES_DIR = './routes';

function scanDirForBadPaths(dir) {
  const files = fs.readdirSync(dir);
  let broken = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const regex = /router\.(get|post|put|delete|patch)\(['"`](\/:[^\/]+:[^'"`]+)['"`]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      broken.push({ file, path: match[2] });
    }
  }

  return broken;
}

const result = scanDirForBadPaths(ROUTES_DIR);
if (result.length === 0) {
  console.log("✅ No malformed route paths found!");
} else {
  console.log("❌ Found malformed route paths:");
  result.forEach(r => {
    console.log(`- ${r.file} ➜ ${r.path}`);
  });
}