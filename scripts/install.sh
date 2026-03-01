#!/usr/bin/env bash
#
# opencode-memory installer
# Usage: curl -sSL https://.../install.sh | bash
#        or: ./install.sh [--scope global|project] [--provider NAME] [--model MODEL]
#
set -euo pipefail

# ============ CONFIG ============
REPO_URL="https://github.com/clouitreee/opencode-memory"
RELEASE_URL="https://github.com/clouitreee/opencode-memory/releases/latest/download"
PLUGIN_NAME="opencode-memory"
VERSION="${OPENCODE_MEMORY_VERSION:-latest}"
SCOPE="global"
PROVIDER=""
MODEL=""
VERBOSE=false
NO_BACKUP=false

# ============ COLORS ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============ LOGGING ============
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# ============ DETECTION ============
detect_platform() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  
            if grep -qi microsoft /proc/version 2>/dev/null; then
                echo "wsl"
            else
                echo "linux"
            fi
            ;;
        *) echo "unknown" ;;
    esac
}

check_dependencies() {
    local missing=()
    
    if ! command -v bun &>/dev/null; then
        missing+=("bun")
    fi
    
    if ! command -v opencode &>/dev/null; then
        missing+=("opencode")
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing[*]}"
        log_info "Install them first:"
        for dep in "${missing[@]}"; do
            case $dep in
                bun)     echo "  curl -fsSL https://bun.sh/install | bash" ;;
                opencode) echo "  Visit: https://opencode.ai" ;;
            esac
        done
        exit 1
    fi
    
    log_ok "All dependencies found"
}

get_opencode_config_dir() {
    echo "${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
}

get_opencode_data_dir() {
    echo "${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}"
}

get_plugin_install_dir() {
    if [ "$SCOPE" = "project" ]; then
        echo "$(pwd)/.opencode/plugins/opencode-memory"
    else
        echo "$(get_opencode_data_dir)/plugins/opencode-memory"
    fi
}

# ============ BACKUP ============
backup_file() {
    local file="$1"
    if [ -f "$file" ]; then
        if [ "$NO_BACKUP" = true ]; then
            return 0
        fi
        local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$file" "$backup"
        log_info "Backup created: $backup"
        echo "$backup"
    fi
}

# ============ INSTALLATION ============
download_release() {
    local install_dir="$1"
    local tmp_dir
    
    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    log_info "Downloading $PLUGIN_NAME $VERSION..."
    
    # Try npm first
    if bun add --global "$PLUGIN_NAME" 2>/dev/null; then
        log_ok "Installed from npm"
        return 0
    fi
    
    # Fallback to GitHub
    local tarball_url
    if [ "$VERSION" = "latest" ]; then
        tarball_url="$RELEASE_URL/opencode-memory.tar.gz"
    else
        tarball_url="https://github.com/clouitreee/opencode-memory/archive/refs/tags/v${VERSION}.tar.gz"
    fi
    
    if curl -fsSL "$tarball_url" | tar -xzf - -C "$tmp_dir" --strip-components=1 2>/dev/null; then
        mkdir -p "$install_dir"
        cp -r "$tmp_dir"/* "$install_dir/"
        log_ok "Downloaded from GitHub"
        return 0
    fi
    
    log_error "Failed to download $PLUGIN_NAME"
    return 1
}

install_from_source() {
    local install_dir="$1"
    
    log_info "Installing from source..."
    
    if [ -d ".git" ] && [ -f "src/plugin.ts" ]; then
        # We're in the repo
        mkdir -p "$install_dir"
        cp -r dist migrations package.json "$install_dir/"
        log_ok "Installed from local source"
        return 0
    fi
    
    # Clone from GitHub
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    git clone --depth 1 "$REPO_URL" "$tmp_dir"
    cd "$tmp_dir"
    bun install --frozen-lockfile
    bun run build
    
    mkdir -p "$install_dir"
    cp -r dist migrations package.json "$install_dir/"
    
    log_ok "Built from source"
    return 0
}

configure_plugin() {
    local config_dir
    config_dir=$(get_opencode_config_dir)
    local config_file="$config_dir/config.json"
    
    mkdir -p "$config_dir"
    
    # Backup existing config
    backup_file "$config_file"
    
    # Create or update config
    if [ ! -f "$config_file" ]; then
        echo '{}' > "$config_file"
    fi
    
    # Add plugin to config
    local plugin_entry="opencode-memory"
    if [ "$SCOPE" = "project" ]; then
        plugin_entry="./.opencode/plugins/opencode-memory"
    fi
    
    # Use a simple approach with bun
    bun -e "
        const fs = require('fs');
        const configPath = '$config_file';
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        if (!config.plugin) config.plugin = [];
        if (!config.plugin.includes('$plugin_entry')) {
            config.plugin.push('$plugin_entry');
        }
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Plugin added to config');
    "
    
    log_ok "Plugin registered in OpenCode config"
}

verify_installation() {
    log_info "Verifying installation..."
    
    local install_dir
    install_dir=$(get_plugin_install_dir)
    
    # Check dist exists
    if [ ! -f "$install_dir/dist/plugin.js" ]; then
        log_error "Plugin not found at $install_dir/dist/plugin.js"
        return 1
    fi
    
    # Check migrations exist
    if [ ! -d "$install_dir/migrations" ]; then
        log_error "Migrations directory not found"
        return 1
    fi
    
    log_ok "Plugin files verified"
    
    # Check DB initialization
    local db_path="$HOME/.opencode-memory/memory.db"
    if [ -f "$db_path" ]; then
        bun -e "
            const { Database } = require('bun:sqlite');
            const db = new Database('$db_path');
            const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
            if (tables.length === 0) {
                console.error('No tables found in database');
                process.exit(1);
            }
            console.log('Database initialized with', tables.length, 'tables');
        " 2>/dev/null && log_ok "Database initialized" || log_warn "Database may need initialization"
    fi
    
    return 0
}

print_success() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  opencode-memory installed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "To verify:"
    echo "  opencode run 'mem-search stats'"
    echo ""
    if [ -n "$PROVIDER" ]; then
        echo "Provider: $PROVIDER"
    fi
    if [ -n "$MODEL" ]; then
        echo "Model: $MODEL"
    fi
    echo ""
    echo "Docs: $REPO_URL#readme"
    echo ""
}

# ============ CLI ============
usage() {
    cat << EOF
opencode-memory installer

Usage:
  curl -sSL https://raw.githubusercontent.com/clouitreee/opencode-memory/main/scripts/install.sh | bash
  ./install.sh [OPTIONS]

Options:
  --scope global|project   Installation scope (default: global)
  --provider NAME          LLM provider (openrouter, openai, anthropic, moonshot, zhipu)
  --model MODEL            LLM model for compression
  --version VERSION        Version to install (default: latest)
  --no-backup              Don't create backups
  --verbose                Verbose output
  -h, --help               Show this help

Examples:
  # Global installation (recommended)
  ./install.sh

  # Project-specific installation
  ./install.sh --scope project

  # With custom provider/model
  ./install.sh --provider openai --model gpt-4o-mini
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --scope)
                SCOPE="$2"
                shift 2
                ;;
            --provider)
                PROVIDER="$2"
                shift 2
                ;;
            --model)
                MODEL="$2"
                shift 2
                ;;
            --version)
                VERSION="$2"
                shift 2
                ;;
            --no-backup)
                NO_BACKUP=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

main() {
    parse_args "$@"
    
    log_info "Installing opencode-memory..."
    log_info "Platform: $(detect_platform)"
    log_info "Scope: $SCOPE"
    
    check_dependencies
    
    local install_dir
    install_dir=$(get_plugin_install_dir)
    
    log_info "Install directory: $install_dir"
    
    # Create install directory
    mkdir -p "$install_dir"
    
    # Install
    if download_release "$install_dir"; then
        :
    else
        install_from_source "$install_dir" || {
            log_error "Installation failed"
            exit 1
        }
    fi
    
    # Configure
    configure_plugin
    
    # Verify
    verify_installation || {
        log_error "Verification failed"
        exit 1
    }
    
    print_success
}

main "$@"
