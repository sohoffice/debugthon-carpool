package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// NewRouter builds the HTTP router with all API routes registered.
func NewRouter() *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	api := r.Group("/api")
	api.GET("/ping", ping)

	return r
}

func ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
