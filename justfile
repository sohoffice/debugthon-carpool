mod backend
mod infra
mod ui

# Showcase, driver and passenger dev servers; Vite uses strictPort, so each must be free
ui_ports := "5170 5173 5174"

# Print all available commands
help:
    @just --list --list-submodules

# Check what `just demo` needs but does not set up: Docker running, Node with TypeScript support, .env and its keys, free UI ports
demo-check:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{source_directory()}}"
    failed=0
    if ! docker info >/dev/null 2>&1; then
        echo "error: Docker is not running; start Docker first" >&2
        failed=1
    fi
    # demo-offstage and the mock server run .ts files directly (Node 22.18+ or 23.6+)
    if ! node -e 'process.exit(process.features.typescript ? 0 : 1)' 2>/dev/null; then
        echo "error: Node $(node --version 2>/dev/null || echo 'is missing') cannot run TypeScript files; install Node 22.18 or later" >&2
        failed=1
    fi
    if [ ! -f .env ]; then
        echo "error: .env is missing; run: cp .env.example .env and fill in the Google keys" >&2
        failed=1
    else
        for key in MAP_API_KEY VITE_GOOGLE_MAPS_API_KEY; do
            grep -q "^$key=." .env || echo "warning: $key is empty in .env; the demo falls back to $([ $key = MAP_API_KEY ] && echo 'simulated routes' || echo 'no map')" >&2
        done
    fi
    for port in {{ui_ports}}; do
        for host in 127.0.0.1 ::1; do
            if (: </dev/tcp/$host/$port) 2>/dev/null; then
                echo "error: port $port is already in use; stop the old UI dev servers first (lsof -nP -iTCP:$port -sTCP:LISTEN)" >&2
                failed=1
                break
            fi
        done
    done
    exit $failed

# Start every demo component on this machine (DD-24): PostgreSQL, the backend with the demo reset on, both UIs and the showcase page
demo: demo-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{source_directory()}}"
    just infra up
    just backend db-apply
    # Restart so the backend runs the current code with the demo reset on
    just backend down
    DEMO_RESET=1 just backend up
    # Reinstall when the lockfile is newer than the last install (e.g. after a pull)
    if [ ! -f ui/node_modules/.package-lock.json ] || [ ui/package-lock.json -nt ui/node_modules/.package-lock.json ]; then
        just ui install
    fi
    echo "showcase http://localhost:5170 · run \`just demo-offstage\` in another terminal for driver5 and the simulator"
    echo "Ctrl-C stops the UIs; the backend keeps running (just backend down)"
    just ui dev

# Run the Demo's off-stage part on the `just demo` setup (T18E): driver5 and the simulator, cues in the terminal; Ctrl-C stops
demo-offstage delay="10":
    cd "{{source_directory()}}/ui" && npx playwright install chromium && node scripts/demo-offstage.ts "{{delay}}"

# Put the demo back to its start (DD-29); rerun `just demo-offstage` to restart the simulator
demo-reset:
    @curl -sf -X POST http://localhost:8080/api/demo/reset && echo "demo reset"
