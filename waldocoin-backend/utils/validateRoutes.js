// utils/validateRoutes.js

import fs from 'fs'
import path from 'path'

const ROUTES_DIR = './routes'

export function validateRoutes() {
  const files = fs.readdirSync(ROUTES_DIR)
  const issues = []

  for (const file of files) {
    const filePath = path.join(ROUTES_DIR, file)
    if (!filePath.endsWith('.js')) continue

    const content = fs.readFileSync(filePath, 'utf8')

    // This regex grabs the route path
    const routeRegex = /router\.(get|post|put|delete|patch)\s*\(\s*['"`](\/[^'"`]+)['"`]/g
    let match

    while ((match = routeRegex.exec(content)) !== null) {
      const routePath = match[2]

      // Only warn on obvious broken params (like /: or /::)
      if (/\/:($|[^a-zA-Z0-9_])/.test(routePath)) {
        issues.push({ file, routePath, error: "Suspicious colon parameter syntax" })
        continue
      }
      // If you want: log that you saw a param, but don't try to parse
      if (routePath.includes("/:")) {
        // Just warn if you want
        // console.warn(`[WARN] Param route found: ${routePath} in ${file}`)
        continue
      }

      // Otherwise, you *could* call parse(routePath) but it's not needed for Express routes
      // parse(routePath)
    }
  }

  if (issues.length === 0) {
    console.log('✅ All route patterns are valid.')
  } else {
    console.log('❌ Found suspicious or broken route patterns:')
    issues.forEach(({ file, routePath, error }) => {
      console.error(`- ${file} ➜ ${routePath} (${error})`)
    })
    process.exit(1)
  }
}
