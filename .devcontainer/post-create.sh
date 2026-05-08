#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing dependencies..."
npm install --no-audit --no-fund

echo
echo "==> Setup complete."
echo
echo "Next steps inside the Codespace:"
echo "  1. Copy .env.example to .env.local and fill in the secrets."
echo "     (Or set them as Codespaces secrets in GitHub repo settings.)"
echo "  2. Run 'npm run dev' to start the app on port 3000."
echo "  3. Run 'claude' to start vibecoding with Claude Code."
echo
