package server

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// checkPark answers whether a lat/lng is inside the park, with the same check the departure and
// the ride request use (REQ-001, DD-32). Outside the park is a normal answer, not an error.
func (s *Server) checkPark(c *gin.Context) {
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
	if errLat != nil || errLng != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		apiError(c, http.StatusBadRequest, "invalid_location", "需要有效的 lat（-90～90）與 lng（-180～180）")
		return
	}
	c.JSON(http.StatusOK, gin.H{"inside": s.park.Contains(lat, lng)})
}
