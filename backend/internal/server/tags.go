package server

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// tag is a tag as the caller's role sees it (DD-42). SelfLabel is how the caller describes
// themselves with it, FilterLabel how they filter the other side by it; each is null when the
// tag does not apply there, and Name is only an internal identifier.
type tag struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Issuer      string  `json:"issuer"`
	AppliesTo   string  `json:"applies_to"`
	SelfLabel   *string `json:"self_label"`
	FilterLabel *string `json:"filter_label"`
	Selected    bool    `json:"selected"`
}

// otherSide is the role whose tags a caller with this role filters by.
func otherSide(role string) string {
	if role == roleDriver {
		return rolePassenger
	}
	return roleDriver
}

// appliesToSQL is a condition on tags t: the tag applies to the side given as parameter $n.
func appliesToSQL(n string) string {
	return `t.applies_to IN ($` + n + `, 'both')`
}

// listTags returns the predefined list with the wording for the caller's role (REQ-086, DD-42),
// marking the ones the caller has selected (REQ-008).
func (s *Server) listTags(c *gin.Context) {
	rows, err := s.db.Query(c, `
		SELECT t.id, t.name, t.issuer, t.applies_to,
		       CASE WHEN $2 = 'driver' THEN t.driver_self_label ELSE t.passenger_self_label END,
		       CASE WHEN $2 = 'driver' THEN t.driver_filter_label ELSE t.passenger_filter_label END,
		       ut.user_id IS NOT NULL
		  FROM tags t
		  LEFT JOIN user_tags ut ON ut.tag_id = t.id AND ut.user_id = $1
		 ORDER BY t.id`, c.GetInt64(ctxUserID), c.GetString(ctxRole))
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []tag{}
	for rows.Next() {
		var t tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Issuer, &t.AppliesTo, &t.SelfLabel, &t.FilterLabel, &t.Selected); err != nil {
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
// users cannot create tag content (DD-05), and so are tags for the other role (REQ-008).
func (s *Server) selectTag(c *gin.Context) {
	tagID, ok := tagIDParam(c)
	if !ok {
		return
	}
	var exists, applies bool
	if err := s.db.QueryRow(c, `SELECT true, `+appliesToSQL("2")+` FROM tags t WHERE t.id = $1`,
		tagID, c.GetString(ctxRole)).Scan(&exists, &applies); err != nil && !isNoRows(err) {
		s.internalError(c, err)
		return
	}
	if !exists {
		apiError(c, http.StatusNotFound, "not_found", "標籤不在清單中")
		return
	}
	if !applies {
		apiError(c, http.StatusBadRequest, "tag_not_applicable", "這個標籤不適用於你的角色")
		return
	}
	if _, err := s.db.Exec(c, `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		c.GetInt64(ctxUserID), tagID); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// checkFilterTags reports whether every filter names a tag from the list (DD-05) that applies
// to side, the role being filtered (REQ-085, DD-42); departing, the supply query and submitting
// a request share it. On a bad tag it writes the 400 itself.
func (s *Server) checkFilterTags(c *gin.Context, filters []tagFilterBody, side string) bool {
	if len(filters) == 0 {
		return true
	}
	known, applicable, err := s.countFilterTags(c, filters, side)
	if err != nil {
		s.internalError(c, err)
		return false
	}
	if known != len(filters) {
		apiError(c, http.StatusBadRequest, "invalid_tag", "標籤不在清單中")
		return false
	}
	if applicable != len(filters) {
		apiError(c, http.StatusBadRequest, "tag_not_applicable", "篩選條件只能使用適用於對方的標籤")
		return false
	}
	return true
}

func (s *Server) countFilterTags(ctx context.Context, filters []tagFilterBody, side string) (known, applicable int, err error) {
	ids := make([]int64, len(filters))
	for i, f := range filters {
		ids[i] = f.TagID
	}
	err = s.db.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE `+appliesToSQL("2")+`)
		  FROM tags t WHERE t.id = ANY($1)`, ids, side).Scan(&known, &applicable)
	return known, applicable, err
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
