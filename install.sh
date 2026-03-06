#!/bin/bash
# LongMem installation script for Unix-like systems
# Usage: curl -fsSL <URL> | sh

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="longmem"
REPO_URL="https://github.com/clouitreee/lmem"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "macos";;
        *)          echo "unknown";;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64)     echo "x86_64";;
        aarch64)    echo "aarch64";;
        arm64)      echo "aarch64";;
        *)          echo "unknown";;
    esac
}

check_dependencies() {
    if ! command -v cargo &> /dev/null; then
        log_error "Rust/Cargo not found. Please install from https://rustup.rs"
        exit 1
    fi
}

install_from_source() {
    log_info "Building from source (cargo build --release)..."
    
    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT
    
    cd "$temp_dir"
    git clone --depth 1 "$REPO_URL" . 2>/dev/null || {
        log_error "Failed to clone repository"
        exit 1
    }
    
    cargo build --release
    
    mkdir -p "$INSTALL_DIR"
    cp "target/release/$BINARY_NAME" "$INSTALL_DIR/"
    
    log_info "Installed to $INSTALL_DIR/$BINARY_NAME"
}

add_to_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        log_warn "$INSTALL_DIR is not in your PATH"
        echo ""
        echo "Add this to your shell profile (.bashrc, .zshrc, etc):"
        echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
        echo ""
    fi
}

main() {
    echo "LongMem Installer"
    echo "================="
    echo ""
    
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    
    log_info "Detected: $os-$arch"
    
    # Check for prebuilt binaries (future feature)
    local use_prebuilt=false
    # TODO: Uncomment when release binaries are available
    # if [[ "$os" != "unknown" && "$arch" != "unknown" ]]; then
    #     use_prebuilt=true
    # fi
    
    if [[ "$use_prebuilt" == "true" ]]; then
        log_info "Would install prebuilt binary (not implemented yet)"
        # TODO: Implement prebuilt binary download
    else
        log_info "Installing from source..."
        check_dependencies
        install_from_source
    fi
    
    add_to_path
    
    echo ""
    log_info "Installation complete!"
    echo ""
    echo "Run 'longmem --help' to get started."
    echo "Run 'longmem init --project <name>' to initialize."
}

main "$@"
