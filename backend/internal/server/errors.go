package server

import "github.com/gin-gonic/gin"

// apiError is the single error body shape: {"error":{"code":...,"message":...}}.
func apiError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}
