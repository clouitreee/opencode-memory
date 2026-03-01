#!/usr/bin/env bash
#
# opencode-memory verification tool
# Usage: ./scripts/verify.sh [--verbose]
#
set -euo pipefail

VERBOSE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[PASS]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }

check_dependencies() {
    log_info "Checking dependencies..."
    
    if command -v bun &>/dev/null; then
        log_ok "bun: $(bun --version)"
    else
        log_error "bun: not found"
        return 1
    fi
    
    if command -v opencode &>/dev/null; then
        log_ok "opencode: $(opencode --version 2>/dev/null || echo 'installed')"
    else
        log_error "opencode: not found"
        return 1
    fi
    
    return 0
}

check_plugin_files() {
    log_info "Checking plugin files..."
    local errors=0
    
    local plugin_dir
    plugin_dir="$HOME/.local/share/opencode/plugins/opencode-memory"
    
    # Check if installed globally
    if [ -d "$plugin_dir" ]; then
        log_ok "Plugin directory: $plugin_dir"
    else
        # Check npm global
        if bun pm ls -g 2>/dev/null | grep -q "opencode-memory"; then
            log_ok "Plugin installed via npm global"
            plugin_dir="$(bun pm bin -g)/../lib/node_modules/opencode-memory"
        else
            log_error "Plugin not installed"
            return 1
        fi
    fi
    
    # Check dist
    if [ -f "$plugin_dir/dist/plugin.js" ]; then
        log_ok "Plugin bundle: $plugin_dir/dist/plugin.js"
    else
        log_error "Plugin bundle not found"
        errors=$((errors + 1))
    fi
    
    # Check migrations
    if [ -d "$plugin_dir/migrations" ]; then
        log_ok "Migrations: $plugin_dir/migrations"
    else
        log_error "Migrations directory not found"
        errors=$((errors + 1))
    fi
    
    return $errors
}

check_config() {
    log_info "Checking OpenCode config..."
    
    local config_file="$HOME/.config/opencode/config.json"
    
    if [ ! -f "$config_file" ]; then
        log_warn "Config file not found: $config_file"
        return 0
    fi
    
    if grep -q "opencode-memory" "$config_file"; then
        log_ok "Plugin registered in config"
    else
        log_warn "Plugin not in config (may not be loaded)"
    fi
    
    # Check for API key in config
    if grep -q "apiKey\|api_key" "$config_file"; then
        log_ok "API key found in config (will be used automatically)"
    else
        log_info "No API key in config (will use env vars)"
    fi
}

check_database() {
    log_info "Checking database..."
    
    local db_path="$HOME/.opencode-memory/memory.db"
    
    if [ ! -f "$db_path" ]; then
        log_warn "Database not found: $db_path"
        log_info "Database will be created on first use"
        return 0
    fi
    
    log_ok "Database: $db_path"
    
    # Check tables using bun
    bun -e "
        const { Database } = require('bun:sqlite');
        const db = new Database('$db_path');
        
        const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all();
        
        console.log('Tables (' + tables.length + '):');
        tables.forEach(t => console.log('  - ' + t.name));
        
        // Check key tables
        const required = ['sessions', 'observations', 'summaries'];
        const existing = tables.map(t => t.name);
        const missing = required.filter(r => !existing.includes(r));
        
        if (missing.length > 0) {
            console.error('Missing tables:', missing.join(', '));
            process.exit(1);
        }
        
        // Stats
        const stats = db.prepare('SELECT COUNT(*) as count FROM observations').get();
        console.log('Observations:', stats.count);
    " 2>&1
    
    if [ $? -eq 0 ]; then
        log_ok "Database structure valid"
    else
        log_error "Database structure invalid (run migrations)"
        return 1
    fi
}

check_env_vars() {
    log_info "Checking environment..."
    
    local found=false
    
    if [ -n "${OPENROUTER_API_KEY:-}" ]; then
        log_ok "OPENROUTER_API_KEY is set"
        found=true
    fi
    
    if [ -n "${OPENAI_API_KEY:-}" ]; then
        log_ok "OPENAI_API_KEY is set"
        found=true
    fi
    
    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
        log_ok "ANTHROPIC_API_KEY is set"
        found=true
    fi
    
    if [ "$found" = false ]; then
        log_info "No API key env vars found (will use OpenCode config)"
    fi
}

test_tool() {
    log_info "Testing mem-search tool..."
    
    local output
    output=$(opencode run "mem-search stats" 2>&1 || true)
    
    if echo "$output" | grep -q "Total Sessions\|Total sessions\|observations"; then
        log_ok "mem-search tool working"
        if [ "$VERBOSE" = true ]; then
            echo "$output"
        fi
    elif echo "$output" | grep -q "error\|Error\|ERROR"; then
        log_error "mem-search tool error"
        echo "$output"
        return 1
    else
        log_warn "Could not verify tool (may need interactive session)"
    fi
}

print_summary() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Verification Summary${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Start opencode: opencode"
    echo "  2. Test memory: ask about previous work"
    echo "  3. Check stats: mem-search stats"
    echo ""
    echo "Troubleshooting:"
    echo "  - If tool not found: restart opencode"
    echo "  - If DB errors: rm -rf ~/.opencode-memory && restart opencode"
    echo "  - If compression fails: set OPENROUTER_API_KEY or OPENAI_API_KEY"
    echo ""
}

usage() {
    cat << EOF
opencode-memory verification tool

Usage:
  ./scripts/verify.sh [OPTIONS]

Options:
  --verbose    Show detailed output
  -h, --help   Show this help
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --verbose|-v)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                shift
                ;;
        esac
    done
}

main() {
    parse_args "$@"
    
    echo -e "${BLUE}opencode-memory verification${NC}"
    echo ""
    
    local errors=0
    
    check_dependencies || errors=$((errors + 1))
    check_plugin_files || errors=$((errors + 1))
    check_config
    check_database || errors=$((errors + 1))
    check_env_vars
    test_tool || errors=$((errors + 1))
    
    print_summary
    
    if [ $errors -gt 0 ]; then
        log_error "$errors check(s) failed"
        exit 1
    fi
    
    log_ok "All checks passed!"
}

main "$@"
