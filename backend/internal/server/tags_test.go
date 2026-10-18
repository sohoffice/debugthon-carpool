package server

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
)

type tagView struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Issuer   string `json:"issuer"`
	Selected bool   `json:"selected"`
}

// firstTag returns a tag from the seeded list.
func firstTag(t *testing.T, tx pgx.Tx) (id int64, name string) {
	t.Helper()
	err := tx.QueryRow(context.Background(), `SELECT id, name FROM tags ORDER BY id LIMIT 1`).Scan(&id, &name)
	if err != nil {
		t.Fatalf("no seeded tags (apply the tag seed migration): %v", err)
	}
	return id, name
}

func tagCount(t *testing.T, tx pgx.Tx) int {
	t.Helper()
	var n int
	if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM tags`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func findTag(tags []tagView, id int64) *tagView {
	for i := range tags {
		if tags[i].ID == id {
			return &tags[i]
		}
	}
	return nil
}

func TestTagsSelectAndDeselect(t *testing.T) {
	cases := []struct{ name, token, other string }{
		{"driver", "driver:driver1", "passenger:passenger1"},
		{"passenger", "passenger:passenger1", "driver:driver1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tx := testTx(t)
			id, name := firstTag(t, tx)
			// Start from a known state whatever the seed gave these users.
			mustExec(t, tx, `DELETE FROM user_tags WHERE tag_id = $1`, id)
			path := "/api/me/tags/" + strconv.FormatInt(id, 10)

			list := func(token string) *tagView {
				w := call(t, tx, http.MethodGet, "/api/tags", token, "")
				wantStatus(t, w, http.StatusOK, "")
				return findTag(decode[[]tagView](t, w), id)
			}

			if tg := list(tc.token); tg == nil || tg.Selected || tg.Issuer != "self" || tg.Name != name {
				t.Fatalf("unexpected initial tag: %+v", tg)
			}

			wantStatus(t, call(t, tx, http.MethodPut, path, tc.token, ""), http.StatusNoContent, "")
			// Selecting twice is harmless.
			wantStatus(t, call(t, tx, http.MethodPut, path, tc.token, ""), http.StatusNoContent, "")
			if tg := list(tc.token); tg == nil || !tg.Selected {
				t.Fatalf("tag should be selected: %+v", tg)
			}
			// Selection is per user.
			if tg := list(tc.other); tg == nil || tg.Selected {
				t.Fatalf("other user must not see the selection: %+v", tg)
			}

			wantStatus(t, call(t, tx, http.MethodDelete, path, tc.token, ""), http.StatusNoContent, "")
			wantStatus(t, call(t, tx, http.MethodDelete, path, tc.token, ""), http.StatusNoContent, "")
			if tg := list(tc.token); tg == nil || tg.Selected {
				t.Fatalf("tag should be deselected: %+v", tg)
			}
		})
	}
}

func TestTagsOnlyFromList(t *testing.T) {
	tx := testTx(t)
	before := tagCount(t, tx)

	// Selecting an id that is not in the list is rejected.
	wantStatus(t, call(t, tx, http.MethodPut, "/api/me/tags/99999999", "driver:driver1", ""), http.StatusNotFound, "not_found")
	wantStatus(t, call(t, tx, http.MethodPut, "/api/me/tags/abc", "driver:driver1", ""), http.StatusBadRequest, "bad_request")

	// There is no way to create a tag: no create route, and a body cannot add one.
	for _, path := range []string{"/api/tags", "/api/me/tags"} {
		w := call(t, tx, http.MethodPost, path, "driver:driver1", `{"name":"free-text"}`)
		if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s status = %d, want 404 or 405", path, w.Code)
		}
	}
	if got := tagCount(t, tx); got != before {
		t.Fatalf("tag count changed from %d to %d", before, got)
	}
}

func TestTagsRequireAuth(t *testing.T) {
	tx := testTx(t)
	wantStatus(t, call(t, tx, http.MethodGet, "/api/tags", "", ""), http.StatusUnauthorized, "unauthorized")
	wantStatus(t, call(t, tx, http.MethodPut, "/api/me/tags/1", "driver:nobody", ""), http.StatusUnauthorized, "unauthorized")
}
