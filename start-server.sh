#!/bin/bash
echo "🚀 Starting Local VideoJS Player Server on http://localhost:8080..."
echo "Press Ctrl+C to stop the server."
echo ""
python3 -m http.server 8080 --directory "$(dirname "$0")"
