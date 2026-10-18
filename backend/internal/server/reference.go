package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type pickupPoint struct {
	ID      int64   `json:"id"`
	Name    string  `json:"name"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	RadiusM int     `json:"radius_m"`
}

type busStop struct {
	ID     int64   `json:"id"`
	StopID *int    `json:"stop_id"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
}

func (s *Server) getMe(c *gin.Context) {
	var displayName string
	var isDriver, isPassenger, simulated bool
	err := s.db.QueryRow(c, `SELECT display_name, is_driver, is_passenger, simulated FROM users WHERE id = $1`,
		c.GetInt64(ctxUserID)).Scan(&displayName, &isDriver, &isPassenger, &simulated)
	if err != nil {
		s.internalError(c, err)
		return
	}
	roles := []string{}
	if isDriver {
		roles = append(roles, roleDriver)
	}
	if isPassenger {
		roles = append(roles, rolePassenger)
	}
	c.JSON(http.StatusOK, gin.H{
		"username":     c.GetString(ctxUsername),
		"display_name": displayName,
		"role":         c.GetString(ctxRole),
		"roles":        roles,
		"simulated":    simulated,
	})
}

func (s *Server) listPickupPoints(c *gin.Context) {
	rows, err := s.db.Query(c, `SELECT id, name, lat, lng, radius_m FROM pickup_points ORDER BY id`)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []pickupPoint{}
	for rows.Next() {
		var p pickupPoint
		if err := rows.Scan(&p.ID, &p.Name, &p.Lat, &p.Lng, &p.RadiusM); err != nil {
			s.internalError(c, err)
			return
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) listBusStops(c *gin.Context) {
	rows, err := s.db.Query(c, `SELECT id, stop_id, name, lat, lng FROM bus_stops ORDER BY id`)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []busStop{}
	for rows.Next() {
		var b busStop
		if err := rows.Scan(&b.ID, &b.StopID, &b.Name, &b.Lat, &b.Lng); err != nil {
			s.internalError(c, err)
			return
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
