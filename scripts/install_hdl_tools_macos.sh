#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for this installer: https://brew.sh"
  exit 1
fi

brew update
brew install verilator yosys icarus-verilog gtkwave

