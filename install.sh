#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
VIOLET='\033[0;35m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""
echo -e "${VIOLET}${BOLD}  Quillby Installer${RESET}"
echo ""

# ── 1. Node.js check ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗  Node.js is not installed.${RESET}"
  echo ""
  echo "   Install it from https://nodejs.org — click the LTS button."
  echo "   Once done, run this installer again:"
  echo ""
  echo "   curl -fsSL https://raw.githubusercontent.com/vncsleal/quillby/main/install.sh | bash"
  echo ""
  exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${RESET}  Node.js ${NODE_VERSION}"

# ── 2. Install quillby globally ───────────────────────────────────────────────
echo "→  Installing Quillby (npm install -g @vncsleal/quillby)..."
npm install -g @vncsleal/quillby --silent
echo -e "${GREEN}✓${RESET}  Quillby installed"

# ── 3. Resolve absolute paths ─────────────────────────────────────────────────
NODE_BIN=$(node -e "process.stdout.write(process.execPath)")
NPM_GLOBAL_ROOT=$(npm root -g)
SERVER_JS="${NPM_GLOBAL_ROOT}/@vncsleal/quillby/dist/mcp/server.js"

if [[ ! -f "$SERVER_JS" ]]; then
  echo -e "${RED}✗  Could not find ${SERVER_JS}${RESET}"
  echo "   Try running: npm install -g @vncsleal/quillby"
  exit 1
fi

# ── 4. Find Claude Desktop config path ───────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
elif [[ -n "${APPDATA:-}" ]]; then
  CONFIG_DIR="$APPDATA/Claude"
else
  CONFIG_DIR="$HOME/.config/Claude"
fi

CONFIG_FILE="${CONFIG_DIR}/claude_desktop_config.json"

# ── 5. Create or merge config ─────────────────────────────────────────────────
mkdir -p "${CONFIG_DIR}"

node -e "
const fs = require('fs');
const configPath = process.argv[1];
const nodeBin = process.argv[2];
const serverJs = process.argv[3];

let config = {};
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
}
config.mcpServers = config.mcpServers || {};
config.mcpServers.quillby = { command: nodeBin, args: [serverJs] };
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
" -- "$CONFIG_FILE" "$NODE_BIN" "$SERVER_JS"

echo -e "${GREEN}✓${RESET}  Claude Desktop config updated"
echo -e "   ${CONFIG_FILE}"

# ── 6. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}✅  Done!${RESET}"
echo ""
echo "   1. Fully quit Claude Desktop (right-click the Dock icon → Quit)."
echo "   2. Reopen Claude Desktop."
echo "   3. In a new chat, type:"
echo ""
echo -e "      ${VIOLET}${BOLD}\"Set me up with Quillby\"${RESET}"
echo ""
