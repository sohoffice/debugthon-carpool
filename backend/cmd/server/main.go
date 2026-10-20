package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
