hello:
    @echo "hello world"

# UI recipes: see ui/CLAUDE.md

ui-install:
    cd ui && npm install

driver:
    cd ui && npm run dev:driver

passenger:
    cd ui && npm run dev:passenger

ui-test:
    cd ui && npm run typecheck && npm test
