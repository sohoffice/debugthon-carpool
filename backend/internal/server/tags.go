package server

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type tag struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Issuer   string `json:"issuer"`
	Selected bool   `json:"selected"`
}

// listTags returns the predefined list, marking the ones the caller has selected (REQ-008).
func (s *Server) listTags(c *gin.Context) {
	rows, err := s.db.Query(c, `
		SELECT t.id, t.name, t.issuer, ut.user_id IS NOT NULL
		  FROM tags t
		  LEFT JOIN user_tags ut ON ut.tag_id = t.id AND ut.user_id = $1
		 ORDER BY t.id`, c.GetInt64(ctxUserID))
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []tag{}
	for rows.Next() {
		var t tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Issuer, &t.Selected); err != nil {
			s.internalError(c, err)
			return
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// selectTag adds a tag from the list to the caller; unknown ids are rejected, so
// users cannot create tag content (DD-05).
func (s *Server) selectTag(c *gin.Context) {
	tagID, ok := tagIDParam(c)
	if !ok {
		return
	}
	res, err := s.db.Exec(c, `
		INSERT INTO user_tags (user_id, tag_id)
		SELECT $1, id FROM tags WHERE id = $2
		ON CONFLICT DO NOTHING`, c.GetInt64(ctxUserID), tagID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	if res.RowsAffected() == 0 {
		// Either already selected or not in the list; tell them apart.
		var exists bool
		if err := s.db.QueryRow(c, `SELECT EXISTS (SELECT 1 FROM tags WHERE id = $1)`, tagID).Scan(&exists); err != nil {
			s.internalError(c, err)
			return
		}
		if !exists {
			apiError(c, http.StatusNotFound, "not_found", "標籤不在清單中")
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) deselectTag(c *gin.Context) {
	tagID, ok := tagIDParam(c)
	if !ok {
		return
	}
	if _, err := s.db.Exec(c, `DELETE FROM user_tags WHERE user_id = $1 AND tag_id = $2`, c.GetInt64(ctxUserID), tagID); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func tagIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		apiError(c, http.StatusBadRequest, "bad_request", "標籤編號格式錯誤")
		return 0, false
	}
	return id, true
}
