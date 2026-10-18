# Launch the infra components (PostgreSQL) in the background
up:
    docker compose -f {{source_directory()}}/docker-compose.yml up -d --wait

# Stop and remove the infra containers (data volume is kept)
down:
    docker compose -f {{source_directory()}}/docker-compose.yml down
