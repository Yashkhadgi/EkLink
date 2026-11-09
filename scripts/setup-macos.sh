#!/usr/bin/env bash
# EkLink setup + run script for macOS 13+ (Apple Silicon or Intel).
#
#   bash scripts/setup-macos.sh [options]
#
# Steps (numbered in the output and in the log file):
#   1. check / install git and Node.js 22.18+ (Homebrew)
#   2. pull the branch (default: main)
#   3. install npm dependencies
#   4. prepare .env (defaults, JWT signing key) and validate it
#   5. run `next dev` in this terminal -> http://localhost:3000
#
# Options:
#   --branch NAME   branch to pull (default: main)
#   --skip-pull     do not fetch / checkout / pull
#   --reinstall     force a clean `npm ci`
#   --no-run        set everything up, do not start
#   --run-only      skip setup, only start (needs a previous setup)
#   --check         diagnose only (tools, .env keys, port); changes nothing
#   --debug         trace every command with line numbers (the log may then contain secrets)
#   -y, --yes       answer yes to every prompt
#   -h, --help      show this help
#
# Log file: <repo>/logs/eklink-setup-macos-<time>.log  (or $PBL_LOG_DIR when set)

main() {
  set -Eeuo pipefail

  local PROJECT="EkLink" SERVICE="eklink"
  local REPO_URL="https://github.com/Yashkhadgi/EkLink.git"
  local APP_PORT=3000
  local REQUIRED_KEYS=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
                       EKLINK_ISSUER_URL EKLINK_JWT_PRIVATE_KEY EKLINK_JWT_KEY_ID)

  local BRANCH="main" SKIP_PULL=0 NO_RUN=0 RUN_ONLY=0 CHECK_ONLY=0 DEBUG=0 ASSUME_YES=0 REINSTALL=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch) BRANCH="${2:?--branch needs a value}"; shift ;;
      --skip-pull) SKIP_PULL=1 ;;
      --reinstall) REINSTALL=1 ;;
      --no-run) NO_RUN=1 ;;
      --run-only) RUN_ONLY=1 ;;
      --check) CHECK_ONLY=1 ;;
      --debug) DEBUG=1 ;;
      -y|--yes) ASSUME_YES=1 ;;
      -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; return 0 ;;
      *) echo "Unknown option: $1 (see --help)" >&2; return 2 ;;
    esac
    shift
  done
  if [ "$NO_RUN" = 1 ] && [ "$RUN_ONLY" = 1 ]; then echo "--no-run and --run-only cannot be combined" >&2; return 2; fi

  # ---------------- logging + error reporting ----------------
  local SCRIPT_DIR; SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local LOG_DIR="${PBL_LOG_DIR:-$SCRIPT_DIR/../logs}"
  mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="${TMPDIR:-/tmp}/pbl-logs"
  mkdir -p "$LOG_DIR"; LOG_DIR="$(cd "$LOG_DIR" && pwd)"
  LOG_FILE="$LOG_DIR/${SERVICE}-setup-macos-$(date +%Y%m%d-%H%M%S).log"
  if [ -t 1 ]; then C_STEP=$'\033[1;36m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_OK=$'\033[1;32m'; C_END=$'\033[0m'
  else C_STEP=""; C_WARN=""; C_ERR=""; C_OK=""; C_END=""; fi
  exec > >(tee -a "$LOG_FILE") 2>&1

  CURRENT_STEP="0. start"; STEP_NO=0
  on_error() {
    [ "${BASH_SUBSHELL:-0}" -eq 0 ] || return 0
    printf '\n%s[x] %s failed in step "%s"%s\n' "$C_ERR" "$PROJECT" "$CURRENT_STEP" "$C_END" >&2
    printf '    line %s: %s\n    exit code: %s   (functions: %s)\n' "$2" "$3" "$1" "${FUNCNAME[*]:1}" >&2
    printf '    full log: %s\n' "$LOG_FILE" >&2
    printf '    next: re-run with --debug to trace every command, or --check to diagnose.\n' >&2
  }
  trap 'rc=$?; on_error "$rc" "$LINENO" "$BASH_COMMAND"' ERR
  if [ "$DEBUG" = 1 ]; then export PS4='+ [line ${LINENO}] '; set -x; fi

  step() { STEP_NO=$((STEP_NO + 1)); CURRENT_STEP="$STEP_NO. $*"; printf '\n%s==> [%s] %s%s\n' "$C_STEP" "$STEP_NO" "$*" "$C_END"; }
  info() { printf '    %s\n' "$*"; }
  ok()   { printf '    %s[ok]%s %s\n' "$C_OK" "$C_END" "$*"; }
  warn() { printf '%s[!] %s%s\n' "$C_WARN" "$*" "$C_END"; }
  die()  { printf '%s[x] %s%s\n    step: %s\n    log:  %s\n' "$C_ERR" "$*" "$C_END" "$CURRENT_STEP" "$LOG_FILE" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }
  confirm() {
    [ "$ASSUME_YES" = 1 ] && return 0
    [ -t 0 ] || return 1
    local reply; read -r -p "    $1 [Y/n] " reply || true
    case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac
  }
  retry() {
    local max=$1 n=1; shift
    until "$@"; do
      if [ "$n" -ge "$max" ]; then return 1; fi
      warn "Attempt $n/$max failed: $*  (retrying in $((n * 5))s)"
      sleep $((n * 5)); n=$((n + 1))
    done
  }
  port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
  node_ok() { have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; }

  ENV_FILE=".env"; ENV_BACKED_UP=0
  env_get() {
    node - "$ENV_FILE" "$1" <<'JS'
const fs = require("fs");
const [file, key] = process.argv.slice(2);
if (!fs.existsSync(file)) process.exit(0);
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (m && m[1] === key) {
    let v = m[2].trim();
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    process.stdout.write(v);
    break;
  }
}
JS
  }
  env_set() {
    if [ "$ENV_BACKED_UP" = 0 ] && [ -f "$ENV_FILE" ]; then
      local bak; bak="$LOG_DIR/${SERVICE}.env.$(date +%Y%m%d-%H%M%S).bak"
      cp "$ENV_FILE" "$bak" && chmod 600 "$bak" && info "Backed up $ENV_FILE -> $bak"
      ENV_BACKED_UP=1
    fi
    node - "$ENV_FILE" "$1" "$2" <<'JS'
const fs = require("fs");
const [file, key, value] = process.argv.slice(2);
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
while (lines.length && lines[lines.length - 1] === "") lines.pop();
const re = new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=");
const i = lines.findIndex((l) => re.test(l));
if (i >= 0) lines[i] = key + "=" + value; else lines.push(key + "=" + value);
fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
JS
  }
  missing_keys() { local k; for k in "${REQUIRED_KEYS[@]}"; do [ -n "$(env_get "$k")" ] || echo "$k"; done; }

  info "$PROJECT setup (macOS) | branch=$BRANCH | log: $LOG_FILE"
  local ROOT=""
  ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

  # ---------------- --check ----------------
  if [ "$CHECK_ONLY" = 1 ]; then
    step "Diagnosis (nothing is changed)"
    local problems=0
    bad() { printf '    %s[problem]%s %s\n' "$C_ERR" "$C_END" "$*"; problems=$((problems + 1)); }
    info "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') ($(uname -m))"
    have brew && ok "$(brew --version | head -n1)" || warn "Homebrew not found"
    have git && ok "git $(git --version | awk '{print $3}')" || bad "git is not installed"
    node_ok && ok "node $(node --version), npm $(npm --version)" || bad "Node.js 22.18+ not found (which node: $(command -v node || echo none))"
    if [ -n "$ROOT" ]; then
      cd "$ROOT"; ok "repository: $ROOT (branch $(git rev-parse --abbrev-ref HEAD))"
      [ -d node_modules ] && ok "node_modules present" || bad "node_modules missing"
      [ -f .env ] || { [ -f .env.local ] && ENV_FILE=".env.local"; }
      if [ -f "$ENV_FILE" ] && have node; then
        local miss; miss="$(missing_keys | tr '\n' ' ')"
        [ -z "$miss" ] && ok "all required keys set in $ENV_FILE" || bad "empty keys in $ENV_FILE: $miss"
      else bad "no .env file (copy .env.example to .env)"; fi
    else bad "not inside the $PROJECT git repository"; fi
    port_busy "$APP_PORT" && info "port $APP_PORT in use: $(lsof -nP -iTCP:$APP_PORT -sTCP:LISTEN | awk 'NR==2{print $1" pid "$2}')" || info "port $APP_PORT free"
    if [ "$problems" -eq 0 ]; then printf '\n%sNo problems found.%s\n' "$C_OK" "$C_END"; return 0; fi
    printf '\n%s%s problem(s) found (see above).%s\n' "$C_ERR" "$problems" "$C_END"; return 1
  fi

  # ---------------- 1. tools ----------------
  if [ "$RUN_ONLY" = 0 ]; then
    step "Checking required software"
    info "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') ($(uname -m))"
    if ! have git && ! xcode-select -p >/dev/null 2>&1; then
      xcode-select --install 2>/dev/null || true
      die "Finish the Command Line Tools installer window, then re-run this script."
    fi
    if ! node_ok || ! have git; then
      if ! have brew; then
        local b; for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
      fi
      if ! have brew; then
        warn "Homebrew is needed to install the missing tools. Install it from https://brew.sh :"
        info '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        die "Then open a new terminal and re-run this script."
      fi
      have git || retry 2 brew install git || die "brew install git failed"
      if ! node_ok; then
        confirm "Node.js 22.18+ not found. Install Node.js with Homebrew?" || die "Node.js 22.18+ is required."
        retry 2 brew install node || die "brew install node failed"
        hash -r
        node_ok || die "Node.js install failed (an older node may be first on PATH: check 'which node', nvm?)."
      fi
    fi
    ok "git $(git --version | awk '{print $3}'), node $(node --version), npm $(npm --version)"
  else
    node_ok || die "Node.js 22.18+ not found; run the full setup first."
  fi

  # ---------------- 2. repository ----------------
  if [ -z "$ROOT" ]; then
    ROOT="$PWD/$PROJECT"
    if [ -d "$ROOT/.git" ]; then info "Using existing clone: $ROOT"
    elif [ "$RUN_ONLY" = 1 ]; then die "Repository not found at $ROOT."
    else retry 3 git clone --branch "$BRANCH" "$REPO_URL" "$ROOT" || die "git clone failed"; fi
  fi
  cd "$ROOT"
  if [ -d .git/info ] && ! grep -qx 'logs/' .git/info/exclude 2>/dev/null; then echo 'logs/' >> .git/info/exclude; fi

  if [ "$RUN_ONLY" = 0 ]; then
    step "Getting the code (branch: $BRANCH)"
    if [ "$SKIP_PULL" = 0 ]; then
      if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        git status --short --untracked-files=no | sed 's/^/      /'
        die "Uncommitted changes (listed above). Commit or stash them, or re-run with --skip-pull."
      fi
      retry 3 git fetch origin "$BRANCH" || die "git fetch failed (network? does '$BRANCH' exist on origin?)"
      if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
        if git show-ref --verify --quiet "refs/heads/$BRANCH"; then git checkout "$BRANCH"
        else git checkout -b "$BRANCH" --track "origin/$BRANCH"; fi
      fi
      git pull --ff-only origin "$BRANCH" || die "git pull --ff-only failed: local branch has diverged from origin/$BRANCH."
      ok "at $(git log -1 --format='%h %s')"
    else
      info "Skipping git pull (--skip-pull). Current: $(git rev-parse --abbrev-ref HEAD) $(git log -1 --format='%h')"
    fi

    step "Installing npm dependencies"
    if [ "$REINSTALL" = 0 ] && [ -f node_modules/.package-lock.json ] && [ node_modules/.package-lock.json -nt package-lock.json ]; then
      ok "node_modules is up to date (use --reinstall to force)"
    elif ! retry 2 npm ci --no-audit --no-fund; then
      warn "npm ci failed; trying npm install"
      retry 2 npm install --no-audit --no-fund || die "npm install failed (network, disk space, Node version?)."
    fi
  fi

  # ---------------- 4. .env ----------------
  [ -f .env ] || { [ -f .env.local ] && ENV_FILE=".env.local"; }
  if [ "$RUN_ONLY" = 0 ]; then
    step "Configuring $ENV_FILE"
    if [ ! -f "$ENV_FILE" ]; then cp .env.example "$ENV_FILE"; chmod 600 "$ENV_FILE"; info "Created $ENV_FILE from .env.example"; fi
    [ -n "$(env_get EKLINK_ISSUER_URL)" ] || { env_set EKLINK_ISSUER_URL "http://localhost:$APP_PORT"; info "EKLINK_ISSUER_URL -> http://localhost:$APP_PORT"; }
    if [ -z "$(env_get EKLINK_JWT_PRIVATE_KEY)" ] || [ -z "$(env_get EKLINK_JWT_KEY_ID)" ]; then
      info "Generating the ES256 token signing key (scripts/generate-jwt-keys.mjs)"
      local keys kid pem
      keys="$(node scripts/generate-jwt-keys.mjs)" || die "Key generation failed (dependencies installed?)."
      kid="$(printf '%s\n' "$keys" | sed -n 's/^EKLINK_JWT_KEY_ID=//p')"
      pem="$(printf '%s\n' "$keys" | sed -n 's/^EKLINK_JWT_PRIVATE_KEY=//p')"
      [ -n "$kid" ] && [ -n "$pem" ] || die "Could not read the generated key."
      env_set EKLINK_JWT_KEY_ID "$kid"; env_set EKLINK_JWT_PRIVATE_KEY "$pem"; ok "signing key written"
    fi
  fi
  local miss; miss="$(missing_keys | tr '\n' ' ')"
  [ -z "$miss" ] || die "These keys are empty in $ROOT/$ENV_FILE: $miss
    Fill them in and re-run. Supabase values: Supabase dashboard -> Project Settings -> API."
  ok "all required keys are set in $ENV_FILE"

  if [ "$NO_RUN" = 1 ]; then
    step "Setup complete"; info "Start it with: bash scripts/setup-macos.sh --run-only   (or: npm run dev)"; return 0
  fi

  # ---------------- 5. run ----------------
  step "Starting the dev server (http://localhost:$APP_PORT)"
  if port_busy "$APP_PORT"; then
    lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN | sed 's/^/      /' || true
    die "Port $APP_PORT is already in use (listed above). Stop that process and re-run."
  fi
  info "Press Ctrl+C to stop."
  npm run dev -- --port "$APP_PORT"
}

main "$@"
