#!/usr/bin/env bash
#
# opencode-memory uninstaller
# Usage: ./uninstall.sh [--purge]
#
set -euo pipefail

# ============ CONFIG ============
PLUGIN_NAME="@solidmelon/opencode-memory"
PURGE=false
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

# ============ PATHS ============
get_opencode_config_dir() {
    echo "${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
}

get_opencode_data_dir() {
    echo "${OPENCODE_DATA_DIR:-$HOME/.local/share/opencode}"
}

get_memory_data_dir() {
    echo "${OPENCODE_MEMORY_DATA_DIR:-$HOME/.opencode-memory}"
}

# ============ BACKUP ============
backup_dir() {
    local dir="$1"
    if [ -d "$dir" ]; then
        if [ "$NO_BACKUP" = true ]; then
            return 0
        fi
        local backup="${dir}.backup.$(date +%Y%m%d_%H%M%S)"
        mv "$dir" "$backup"
        log_info "Backup created: $backup"
        echo "$backup"
    fi
}

# ============ UNINSTALL ============
remove_from_config() {
    local config_dir
    config_dir=$(get_opencode_config_dir)
    local config_file="$config_dir/config.json"
    
    if [ ! -f "$config_file" ]; then
        log_info "No config file to modify"
        return 0
    fi
    
    # Backup config
    backup_file "$config_file"
    
    # Remove plugin entry
    bun -e "
        const fs = require('fs');
        const configPath = '$config_file';
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        if (config.plugin) {
            config.plugin = config.plugin.filter(p => 
                p !== 'opencode-memory' && 
                !p.includes('opencode-memory')
            );
            if (config.plugin.length === 0) {
                delete config.plugin;
            }
        }
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Plugin removed from config');
    "
    
    log_ok "Plugin removed from OpenCode config"
}

backup_file() {
    local file="$1"
    if [ -f "$file" ]; then
        local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$file" "$backup"
        echo "$backup"
    fi
}

remove_global_installation() {
    local install_dir
    install_dir="$(get_opencode_data_dir)/plugins/$PLUGIN_NAME"
    
    if [ -d "$install_dir" ]; then
        backup_dir "$install_dir"
        rm -rf "$install_dir"
        log_ok "Global installation removed"
    else
        log_info "No global installation found"
    fi
}

remove_project_installation() {
    local install_dir="$(pwd)/.opencode/plugins/$PLUGIN_NAME"
    
    if [ -d "$install_dir" ]; then
        backup_dir "$install_dir"
        rm -rf "$install_dir"
        log_ok "Project installation removed"
    fi
    
    # Clean up empty parent dirs
    local plugins_dir="$(pwd)/.opencode/plugins"
    if [ -d "$plugins_dir" ] && [ -z "$(ls -A $plugins_dir 2>/dev/null)" ]; then
        rmdir "$plugins_dir"
    fi
    local opencode_dir="$(pwd)/.opencode"
    if [ -d "$opencode_dir" ] && [ -z "$(ls -A $opencode_dir 2>/dev/null)" ]; then
        rmdir "$opencode_dir"
    fi
}

remove_npm_global() {
    if bun pm ls -g 2>/dev/null | grep -q "$PLUGIN_NAME"; then
        bun remove --global "$PLUGIN_NAME"
        log_ok "Removed from npm global"
    fi
}

remove_data() {
    local data_dir
    data_dir=$(get_memory_data_dir)
    
    if [ "$PURGE" = true ]; then
        if [ -d "$data_dir" ]; then
            backup_dir "$data_dir"
            rm -rf "$data_dir"
            log_ok "Data directory purged"
        fi
    else
        log_info "Data directory preserved at: $data_dir"
        log_info "Use --purge to remove all data including memories"
    fi
}

# ============ CLI ============
usage() {
    cat << EOF
opencode-memory uninstaller

Usage:
  ./uninstall.sh [OPTIONS]

Options:
  --purge       Remove all data including memories (DANGER!)
  --no-backup   Don't create backups before removing
  -h, --help    Show this help

Examples:
  # Standard uninstall (preserves memories)
  ./uninstall.sh

  # Complete removal including all stored memories
  ./uninstall.sh --purge
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --purge)
                PURGE=true
                shift
                ;;
            --no-backup)
                NO_BACKUP=true
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

print_success() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  opencode-memory uninstalled!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    
    if [ "$PURGE" = false ]; then
        echo "Memories preserved at: $(get_memory_data_dir)"
        echo "To completely remove, run: ./uninstall.sh --purge"
    fi
    echo ""
}

main() {
    parse_args "$@"
    
    if [ "$PURGE" = true ]; then
        log_warn "PURGE mode: ALL memories will be deleted!"
        read -p "Are you sure? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cancelled"
            exit 0
        fi
    fi
    
    log_info "Uninstalling opencode-memory..."
    
    remove_from_config
    remove_global_installation
    remove_project_installation
    remove_npm_global
    remove_data
    
    print_success
}

main "$@"
