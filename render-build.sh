#!/usr/bin/env bash
set -euo pipefail

# Render Static Site build helper
# Copies the staking widget to index.html so Render can serve it as the site root.
# Usage in Render (Static Site):
#   - Build Command: bash render-build.sh
#   - Publish Directory: WordPress/widgets

echo "Preparing WALDOCOIN static site for Render..."

# Ensure the widget exists
if [ ! -f WordPress/widgets/waldo-staking-widget.html ]; then
  echo "Error: WordPress/widgets/waldo-staking-widget.html not found" >&2
  exit 1
fi

# Create index.html for Render to serve
cp WordPress/widgets/waldo-staking-widget.html WordPress/widgets/index.html

# Optional: you could add more copies here for other widgets/pages
# cp WordPress/widgets/waldo-dual-trade-widget.html WordPress/widgets/trade.html || true

echo "Static site prepared. Publish directory: WordPress/widgets"

