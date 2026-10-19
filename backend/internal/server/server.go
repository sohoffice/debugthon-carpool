package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/sohoffice/debugthon-carpool/backend/internal/park"
)

// DB is satisfied by *pgxpool.Pool and pgx.Tx (tests run inside a transaction).
type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Server holds the dependencies shared by all handlers.
type Server struct {
	db     DB
	park   *park.Boundary
	routes RouteProvider
	walks  WalkProvider
}

// Deps are the collaborators that are not the database.
type Deps struct {
	Park   *park.Boundary // 內湖科學園區 boundary, for checking destinations
	Routes RouteProvider  // plans the pickup -> destination route; nil means the simulated straight line
	Walks  WalkProvider   // walking times for ranking drop-offs; nil means the simulated straight line
}

func newServer(db DB, deps Deps) *Server {
	s := &Server{db: db, park: deps.Park, routes: deps.Routes, walks: deps.Walks}
	if s.routes == nil {
		s.routes = straightRoute{}
	}
	if s.walks == nil {
		s.walks = straightWalk{}
	}
	return s
}

// RunTimeouts moves requests whose driver did not answer in time to the next car, every second
// until ctx ends (DD-13). Polls also run the same check, so a missed tick only delays it.
func RunTimeouts(ctx context.Context, db DB, deps Deps) {
	s := newServer(db, deps)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.expireRequests(ctx); err != nil && ctx.Err() == nil {
				log.Printf("request timeouts: %v", err)
			}
		}
	}
}

// NewRouter builds the HTTP router with all API routes registered.
func NewRouter(db DB, deps Deps) *gin.Engine {
	s := newServer(db, deps)

	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(gin.Logger(), gin.Recovery())
	r.NoRoute(func(c *gin.Context) { apiError(c, http.StatusNotFound, "not_found", "找不到這個 API") })
	r.NoMethod(func(c *gin.Context) {
		apiError(c, http.StatusMethodNotAllowed, "method_not_allowed", "不支援這個方法")
	})

	api := r.Group("/api")
	api.GET("/ping", ping)
	api.POST("/demo/reset", s.resetDemo)

	// Any authenticated role.
	authed := api.Group("", s.authenticate)
	authed.GET("/me", s.getMe)
	authed.GET("/pickup-points", s.listPickupPoints)
	authed.GET("/bus-stops", s.listBusStops)
	authed.GET("/tags", s.listTags)
	authed.PUT("/me/tags/:id", s.selectTag)
	authed.DELETE("/me/tags/:id", s.deselectTag)
	authed.POST("/activities", s.createActivity)
	authed.POST("/location", s.reportLocation)
	authed.GET("/me/location-reports", s.listMyLocationReports)
	authed.GET("/trips/:id", s.getTrip)
	authed.GET("/places", s.searchPlaces)

	driver := authed.Group("/driver", requireRole(roleDriver))
	driver.GET("/profile", s.getDriverProfile)
	driver.POST("/trips", s.depart)
	driver.GET("/trips/current", s.currentTrip)
	driver.GET("/trips/defaults", s.tripDefaults)
	driver.POST("/route-preview", s.previewRoute)
	driver.GET("/trip", s.getDriverTrip)
	for _, action := range []string{"accept", "decline", "board", "complete"} {
		driver.POST("/requests/:id/"+action, s.driverAction(action))
	}

	passenger := authed.Group("/passenger", requireRole(rolePassenger))
	passenger.GET("/profile", s.getPassengerProfile)
	passenger.GET("/supply", s.getSupply)
	passenger.POST("/requests", s.postRequest)
	passenger.GET("/request", s.getMyRequest)
	for _, action := range []string{"cancel", "board", "complete"} {
		passenger.POST("/requests/:id/"+action, s.passengerAction(action))
	}

	return r
}

func ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (s *Server) internalError(c *gin.Context, err error) {
	log.Printf("internal error: %v", err)
	apiError(c, http.StatusInternalServerError, "internal", "伺服器發生錯誤")
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
