package server

import (
	"context"
	"errors"
	"log"
	"net/http"

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
	// previews remembers route previews for the departure that follows (DD-21).
	previews *previewCache
}

// Deps are the collaborators that are not the database.
type Deps struct {
	Park   *park.Boundary // 內湖科學園區 boundary, for checking destinations
	Routes RouteProvider  // plans the pickup -> destination route; nil means the simulated straight line
	Walks  WalkProvider   // estimates the walk from a drop-off to the destination; nil means the simulated straight line
	// DemoReset registers POST /api/demo/reset (DD-29). Only the demo environment turns it on.
	DemoReset bool
}

// NewRouter builds the HTTP router with all API routes registered.
func NewRouter(db DB, deps Deps) *gin.Engine {
	s := &Server{db: db, park: deps.Park, routes: deps.Routes, previews: &previewCache{}}
	if s.routes == nil {
		s.routes = straightRoute{}
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

	// Any authenticated role.
	authed := api.Group("", s.authenticate)
	authed.GET("/me", s.getMe)
	authed.GET("/pickup-points", s.listPickupPoints)
	authed.GET("/bus-stops", s.listBusStops)
	authed.GET("/park/check", s.checkPark)
	authed.GET("/tags", s.listTags)
	authed.PUT("/me/tags/:id", s.selectTag)
	authed.DELETE("/me/tags/:id", s.deselectTag)
	authed.POST("/activities", s.createActivity)
	authed.POST("/location", s.reportLocation)
	authed.GET("/me/location-reports", s.listMyLocationReports)
	authed.GET("/trips/:id", s.getTrip)

	driver := authed.Group("/driver", requireRole(roleDriver))
	driver.GET("/profile", s.getDriverProfile)
	driver.POST("/trips", s.depart)
	driver.POST("/route-preview", s.previewRoute)
	driver.GET("/trips/current", s.currentTrip)
	driver.GET("/trips/defaults", s.tripDefaults)
	driver.GET("/requests", s.listDriverRequests)
	driver.POST("/requests/:id/accept", s.respondRequest(true))
	driver.POST("/requests/:id/decline", s.respondRequest(false))
	driver.POST("/requests/:id/board", s.boardRequest)
	driver.POST("/requests/:id/complete", s.completeRequest)
	passenger := authed.Group("/passenger", requireRole(rolePassenger))
	passenger.GET("/profile", s.getPassengerProfile)
	passenger.GET("/supply", s.getSupply)
	passenger.POST("/requests", s.submitRequest)
	passenger.GET("/requests/current", s.currentPassengerRequest)
	passenger.GET("/requests/:id", s.getPassengerRequest)
	passenger.POST("/requests/:id/board", s.boardRequest)
	passenger.POST("/requests/:id/complete", s.completeRequest)

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
