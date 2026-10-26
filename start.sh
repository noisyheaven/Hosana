#!/usr/bin/env bash
# Menjalankan server toko (Mac/Linux). Jalankan sekali: chmod +x start.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Unduh versi LTS di https://nodejs.org"; exit 1; }
node server.js
