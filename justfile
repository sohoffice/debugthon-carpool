mod backend
mod infra
mod ui

# Print all available commands
help:
    @just --list --list-submodules

# Start every demo component on this machine (DD-24): PostgreSQL, the backend with the demo reset on, both UIs and the showcase page
demo:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{source_directory()}}"
    just infra up
    just backend db-apply
    # Restart so the backend runs the current code with the demo reset on
    just backend down
    DEMO_RESET=1 just backend up
    [ -d ui/node_modules ] || just ui install
    echo "showcase http://localhost:5170 · driver http://localhost:5173/?debug=1 · passenger http://localhost:5174/?debug=1"
    echo "Ctrl-C stops the UIs; the backend keeps running (just backend down)"
    just ui dev

# Put the demo back to its start (DD-29); reload the debug-mode driver page to restart the simulator
demo-reset:
    @curl -sf -X POST http://localhost:8080/api/demo/reset && echo "demo reset"
