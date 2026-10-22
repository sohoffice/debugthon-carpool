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
	drives DriveTimer
	walks  WalkProvider
	// rankBudget overrides rankingBudget; tests shrink it.
	rankBudget time.Duration
	// now is the real clock; Phase 2 turns it into the commute "now" with commuteNow (DD-41).
	now func() time.Time
	// round is the city dashboard's live simulation round (DD-40 step 5); the Demo reset restarts it.
	round *liveRound
}

// Deps are the collaborators that are not the database.
type Deps struct {
	Park   *park.Boundary // 內湖科學園區 boundary, for checking destinations
	Routes RouteProvider  // plans the pickup -> destination route; nil means the simulated straight line
	Drives DriveTimer     // times a car's ETA and the ride to a drop-off place; nil means the simulated estimate
	Walks  WalkProvider   // estimates the walk from a drop-off to the destination; nil means the simulated straight line
	// DemoReset registers POST /api/demo/reset (DD-29). Only the demo environment turns it on.
	DemoReset bool
	// Clock is the real clock; nil means time.Now. Tests pin it to check the commute "now" (DD-41).
	Clock func() time.Time
}

// NewRouter builds the HTTP router with all API routes registered.
func NewRouter(db DB, deps Deps) *gin.Engine {
	s := &Server{db: db, park: deps.Park, routes: deps.Routes, now: deps.Clock, round: &liveRound{}}
	if s.now == nil {
		s.now = time.Now
	}
	if s.routes == nil {
		s.routes = straightRoute{}
	}
	s.drives = deps.Drives
	if s.drives == nil {
		s.drives = straightRoute{}
	}
	s.walks = deps.Walks
	if s.walks == nil {
		s.walks = straightWalk{}
	}

	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(gin.Logger(), gin.Recovery())
	r.NoRoute(func(c *gin.Context) { apiError(c, http.StatusNotFound, "not_found", "找不到這個 API") })
	r.NoMethod(func(c *gin.Context) {
		apiError(c, http.StatusMethodNotAllowed, "method_not_allowed", "不支援這個方法")
	})

	api := r.Group("/api")
	api.GET("/ping", ping)
	if deps.DemoReset {
		// DD-29: no token, like ping; the showcase page calls it.
		api.POST("/demo/reset", s.resetDemo)
	}

	authed := api.Group("", s.authenticate)
	// Drivers and passengers. A city token calls only /api/city/* (DD-39).
	user := authed.Group("", requireRole(roleDriver, rolePassenger))
	user.GET("/me", s.getMe)
	user.GET("/pickup-points", s.listPickupPoints)
	user.GET("/bus-stops", s.listBusStops)
	user.GET("/park/check", s.checkPark)
	user.GET("/tags", s.listTags)
	user.PUT("/me/tags/:id", s.selectTag)
	user.DELETE("/me/tags/:id", s.deselectTag)
	user.POST("/activities", s.createActivity)
	user.POST("/location", s.reportLocation)
	user.GET("/me/location-reports", s.listMyLocationReports)
	user.GET("/trips/:id", s.getTrip)
	user.GET("/commute/traffic", s.getCommuteTraffic) // Phase 2, REQ-077
	user.GET("/commute/weather", s.getCommuteWeather)
	user.GET("/commute/pickup-rides", s.getPickupRides) // Phase 2, REQ-056

	driver := user.Group("/driver", requireRole(roleDriver))
	driver.GET("/profile", s.getDriverProfile)
	driver.GET("/points", s.getDriverPoints)
	driver.POST("/trips", s.depart)
	driver.POST("/route-preview", s.previewRoute)
	driver.GET("/trips/current", s.currentTrip)
	driver.GET("/trips/defaults", s.tripDefaults)
	driver.GET("/requests", s.listDriverRequests)
	driver.POST("/requests/:id/accept", s.respondRequest(true))
	driver.POST("/requests/:id/decline", s.respondRequest(false))
	driver.POST("/requests/:id/board", s.boardRequest)
	driver.POST("/requests/:id/complete", s.completeRequest)
	passenger := user.Group("/passenger", requireRole(rolePassenger))
	passenger.GET("/profile", s.getPassengerProfile)
	passenger.GET("/supply", s.getSupply)
	passenger.POST("/requests", s.submitRequest)
	passenger.GET("/requests/current", s.currentPassengerRequest)
	passenger.GET("/requests/:id", s.getPassengerRequest)
	passenger.POST("/requests/:id/board", s.boardRequest)
	passenger.POST("/requests/:id/complete", s.completeRequest)

	// City dashboard, Phase 2 (DD-39): aggregates and anonymous positions only (REQ-081).
	city := authed.Group("/city", requireRole(roleCity))
	city.GET("/live", s.getCityLive)
	city.GET("/traffic", s.getCityTraffic)
	city.GET("/today", s.getCityToday)
	city.GET("/history", s.getCityHistory)

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
