package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/sohoffice/debugthon-carpool/backend/internal/park"
	"github.com/sohoffice/debugthon-carpool/backend/internal/server"
)

func main() {
	loadEnvFile(".")
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
	deps := server.Deps{Park: boundary, DemoReset: demoReset()}
	// DD-09: routes, driving times and walks come from Google when there is a key, else the simulation.
	if key := os.Getenv("MAP_API_KEY"); key != "" {
		travel := server.NewGoogleTravel(key)
		deps.Routes, deps.Drives, deps.Walks = travel, travel, travel
		log.Print("travel estimates: google (MAP_API_KEY is set)")
	} else {
		log.Print("travel estimates: simulated (MAP_API_KEY is not set)")
	}
	if deps.DemoReset {
		log.Print("DEMO_RESET is on: POST /api/demo/reset is registered")
	}

	// DD-13: overdue requests are reassigned from the database deadlines, also after a restart.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go server.RunTimeoutSweeper(ctx, pool, time.Second)

	// The signal that stops the sweeper stops the HTTP server too; otherwise a stopped backend
	// keeps serving without reassigning overdue requests.
	srv := &http.Server{Addr: addr, Handler: server.NewRouter(pool, deps)}
	// ListenAndServe returns as soon as Shutdown starts; done lets in-flight requests finish
	// before main returns and closes the pool.
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Print(err)
		}
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-done
}

// loadEnvFile loads the first .env found: dir/.env, else the parent's (the backend runs from
// backend/, the repo-root .env is one level up). It never merges the two and goes no further up.
// No file is not an error; variables already in the environment win, even when set to empty.
func loadEnvFile(dir string) {
	for _, p := range []string{filepath.Join(dir, ".env"), filepath.Join(dir, "..", ".env")} {
		if _, err := os.Stat(p); err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				log.Fatalf("load %s: %v", p, err)
			}
			continue
		}
		if err := godotenv.Load(p); err != nil {
			log.Fatalf("load %s: %v", p, err)
		}
		log.Printf("loaded environment from %s", p)
		return
	}
	log.Print("no .env found in the working directory or its parent")
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

// demoReset reports whether DEMO_RESET turns on the demo reset API (DD-29); off unless set to a true value.
func demoReset() bool {
	on, err := strconv.ParseBool(os.Getenv("DEMO_RESET"))
	return err == nil && on
}
