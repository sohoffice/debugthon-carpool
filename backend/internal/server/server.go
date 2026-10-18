package server

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is satisfied by *pgxpool.Pool and pgx.Tx (tests run inside a transaction).
type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Server holds the dependencies shared by all handlers.
type Server struct{ db DB }

// NewRouter builds the HTTP router with all API routes registered.
func NewRouter(db DB) *gin.Engine {
	s := &Server{db: db}

	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.Use(gin.Logger(), gin.Recovery())
	r.NoRoute(func(c *gin.Context) { apiError(c, http.StatusNotFound, "not_found", "找不到這個 API") })
	r.NoMethod(func(c *gin.Context) {
		apiError(c, http.StatusMethodNotAllowed, "method_not_allowed", "不支援這個方法")
	})

	api := r.Group("/api")
	api.GET("/ping", ping)

	// Any authenticated role.
	authed := api.Group("", s.authenticate)
	authed.GET("/me", s.getMe)
	authed.GET("/pickup-points", s.listPickupPoints)
	authed.GET("/bus-stops", s.listBusStops)
	authed.GET("/tags", s.listTags)
	authed.PUT("/me/tags/:id", s.selectTag)
	authed.DELETE("/me/tags/:id", s.deselectTag)

	authed.Group("/driver", requireRole(roleDriver)).GET("/profile", s.getDriverProfile)
	authed.Group("/passenger", requireRole(rolePassenger)).GET("/profile", s.getPassengerProfile)

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
