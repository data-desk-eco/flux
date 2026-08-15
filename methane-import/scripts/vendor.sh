#!/usr/bin/env bash
# vendor dependencies into web/vendor: everything cartograph needs (maplibre,
# DuckDB, Inter, the Data Desk design system, and Cartograph).
set -euo pipefail

CARTOGRAPH="${CARTOGRAPH:-$HOME/Tools/cartograph}"
bash "$CARTOGRAPH/scripts/vendor.sh" web/vendor
