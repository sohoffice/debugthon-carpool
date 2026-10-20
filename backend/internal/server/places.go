package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// maxPlaceResults caps a place search (DD-28).
const maxPlaceResults = 8

type placeView struct {
	ID      int64   `json:"id"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// likeEscaper makes a keyword literal inside an ILIKE pattern.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// searchPlaces returns the park places whose name or address contains the keyword, ignoring
// case (DD-28, REQ-024). Drivers and passengers both use it to pick a destination.
func (s *Server) searchPlaces(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		apiError(c, http.StatusBadRequest, "invalid_request", "需要關鍵字 q")
		return
	}
	pattern := "%" + likeEscaper.Replace(q) + "%"
	rows, err := s.db.Query(c, `
		SELECT id, name, address, lat, lng FROM places
		 WHERE name ILIKE $1 OR address ILIKE $1
		 ORDER BY name, id LIMIT $2`, pattern, maxPlaceResults)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []placeView{}
	for rows.Next() {
		var p placeView
		if err := rows.Scan(&p.ID, &p.Name, &p.Address, &p.Lat, &p.Lng); err != nil {
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
