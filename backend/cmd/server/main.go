package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sohoffice/debugthon-carpool/backend/internal/park"
	"github.com/sohoffice/debugthon-carpool/backend/internal/server"
)

func main() {
	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	pool, err := pgxpool.New(context.Background(), databaseURL())
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	boundary, err := park.Load(parkBoundaryPath())
	if err != nil {
		log.Fatal(err)
	}
	deps := server.Deps{Park: boundary}
	go server.RunTimeouts(context.Background(), pool, deps)
	if err := server.NewRouter(pool, deps).Run(addr); err != nil {
		log.Fatal(err)
	}
}

// databaseURL uses DATABASE_URL if set, else the app role created by the first migration.
func databaseURL() string {
	if u := os.Getenv("DATABASE_URL"); u != "" {
		return u
	}
	get := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	return fmt.Sprintf("postgres://carpool:carpool@localhost:%s/%s?sslmode=disable",
		get("POSTGRES_PORT", "5432"), get("POSTGRES_DB", "carpool"))
}

// parkBoundaryPath uses PARK_BOUNDARY if set, else the GeoJSON in config/ (the backend runs from backend/).
func parkBoundaryPath() string {
	if p := os.Getenv("PARK_BOUNDARY"); p != "" {
		return p
	}
	return "config/park/boundary.geojson"
}
