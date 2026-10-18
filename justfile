mod backend
mod infra

# Print all available commands
help:
    @just --list --list-submodules

# UI 指令：見 ui/CLAUDE.md

ui-install:
    cd ui && npm install

driver:
    cd ui && npm run dev:driver

passenger:
    cd ui && npm run dev:passenger

ui-test:
    cd ui && npm run typecheck && npm test
