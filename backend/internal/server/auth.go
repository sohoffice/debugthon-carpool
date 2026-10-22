package server

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const (
	roleDriver    = "driver"
	rolePassenger = "passenger"
	roleCity      = "city" // city admin, Phase 2 (DD-39)
)

const (
	ctxUserID   = "userID"
	ctxRole     = "role"
	ctxUsername = "username"
)

// authenticate reads `Authorization: Bearer <role>:<username>` (DD-18). The
// account must exist (401) and hold the role (403); nothing else is verified.
func (s *Server) authenticate(c *gin.Context) {
	token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
	role, username, found := strings.Cut(token, ":")
	if !ok || !found || username == "" || (role != roleDriver && role != rolePassenger && role != roleCity) {
		apiError(c, http.StatusUnauthorized, "unauthorized", "需要 Authorization: Bearer <角色>:<帳號>")
		return
	}

	var id int64
	var isDriver, isPassenger, isCity bool
	err := s.db.QueryRow(c, `SELECT id, is_driver, is_passenger, is_city_admin FROM users WHERE username = $1`, username).
		Scan(&id, &isDriver, &isPassenger, &isCity)
	if errors.Is(err, pgx.ErrNoRows) {
		apiError(c, http.StatusUnauthorized, "unauthorized", "帳號不存在")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	if (role == roleDriver && !isDriver) || (role == rolePassenger && !isPassenger) || (role == roleCity && !isCity) {
		apiError(c, http.StatusForbidden, "forbidden", "此帳號沒有該角色")
		return
	}

	c.Set(ctxUserID, id)
	c.Set(ctxRole, role)
	c.Set(ctxUsername, username)
	c.Next()
}

// requireRole limits a route group to the given roles.
func requireRole(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !slices.Contains(roles, c.GetString(ctxRole)) {
			apiError(c, http.StatusForbidden, "forbidden", "此角色不能使用這個 API")
			return
		}
		c.Next()
	}
}
