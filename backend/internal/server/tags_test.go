package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type tagView struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Issuer      string  `json:"issuer"`
	AppliesTo   string  `json:"applies_to"`
	SelfLabel   *string `json:"self_label"`
	FilterLabel *string `json:"filter_label"`
	Selected    bool    `json:"selected"`
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

func tagID(t *testing.T, tx pgx.Tx, name string) int64 {
	t.Helper()
	var id int64
	if err := tx.QueryRow(context.Background(), `SELECT id FROM tags WHERE name = $1`, name).Scan(&id); err != nil {
		t.Fatalf("tag %s: %v", name, err)
	}
	return id
}

// passengerOnlyTag adds a tag that applies only to passengers; the seeded list has none (DD-42).
func passengerOnlyTag(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	var id int64
	if err := tx.QueryRow(context.Background(), `
		INSERT INTO tags (name, applies_to, passenger_self_label, driver_filter_label)
		VALUES ('測試乘客標籤', 'passenger', '我是乘客', '乘客標籤的乘客') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func label(s *string) string {
	if s == nil {
		return "<null>"
	}
	return *s
}

// REQ-086, DD-42: the list carries the wording for the caller's role: how they describe
// themselves and how they filter the other side, null where the tag does not apply.
func TestTagsListUsesTheRoleWording(t *testing.T) {
	tx := testTx(t)
	type want struct{ appliesTo, self, filter string }
	cases := []struct {
		token string
		tags  map[string]want
	}{
		{"driver:driver1", map[string]want{
			"可載行李": {"driver", "車上能放大件行李", "<null>"},
			"不抽菸":  {"both", "我不抽菸", "不抽菸的乘客"},
			"安靜通勤": {"both", "開車喜歡安靜", "喜歡安靜的乘客"},
			"可聊天":  {"both", "可以聊天", "可以聊天的乘客"},
		}},
		{"passenger:passenger1", map[string]want{
			"可載行李": {"driver", "<null>", "能放大件行李"},
			"不抽菸":  {"both", "我不抽菸", "不抽菸"},
			"安靜通勤": {"both", "喜歡安靜", "安靜坐車"},
			"可聊天":  {"both", "可以聊天", "可以聊天"},
		}},
	}
	for _, c := range cases {
		w := call(t, tx, http.MethodGet, "/api/tags", c.token, "")
		wantStatus(t, w, http.StatusOK, "")
		list := decode[[]tagView](t, w)
		// 可帶寵物 and 女性友善 are gone: the list is exactly the DD-42 tags.
		if len(list) != len(c.tags) {
			t.Errorf("%s: %d tags %+v, want %d", c.token, len(list), list, len(c.tags))
		}
		for _, g := range list {
			wt, ok := c.tags[g.Name]
			if !ok {
				t.Errorf("%s: unexpected tag %q", c.token, g.Name)
				continue
			}
			if got := (want{g.AppliesTo, label(g.SelfLabel), label(g.FilterLabel)}); got != wt {
				t.Errorf("%s %s: got %+v, want %+v", c.token, g.Name, got, wt)
			}
		}
	}
}

// REQ-008: a user may only select tags that apply to their role.
func TestTagsSelectOnlyForTheOwnRole(t *testing.T) {
	tx := testTx(t)
	luggage := tagID(t, tx, "可載行李")
	path := "/api/me/tags/" + strconv.FormatInt(luggage, 10)
	_, passenger := newUser(t, tx, rolePassenger)
	_, driver := newUser(t, tx, roleDriver)

	wantStatus(t, call(t, tx, http.MethodPut, path, passenger, ""), http.StatusBadRequest, "tag_not_applicable")
	wantStatus(t, call(t, tx, http.MethodPut, path, driver, ""), http.StatusNoContent, "")
	if tg := findTag(decode[[]tagView](t, call(t, tx, http.MethodGet, "/api/tags", passenger, "")), luggage); tg == nil || tg.Selected {
		t.Errorf("passenger's 可載行李 = %+v, want not selected", tg)
	}
	if tg := findTag(decode[[]tagView](t, call(t, tx, http.MethodGet, "/api/tags", driver, "")), luggage); tg == nil || !tg.Selected {
		t.Errorf("driver's 可載行李 = %+v, want selected", tg)
	}

	// The other way round: a passenger-only tag is refused to a driver.
	own := "/api/me/tags/" + strconv.FormatInt(passengerOnlyTag(t, tx), 10)
	wantStatus(t, call(t, tx, http.MethodPut, own, driver, ""), http.StatusBadRequest, "tag_not_applicable")
	wantStatus(t, call(t, tx, http.MethodPut, own, passenger, ""), http.StatusNoContent, "")
}

// REQ-013, REQ-085: a driver departs only with required filters on tags that apply to passengers.
func TestDepartTagFilterRules(t *testing.T) {
	tx := testTx(t)
	pickupID := firstPickupID(t, tx)
	filter := func(id int64, intent string) string {
		return `"tag_filters":[{"tag_id":` + itoa(id) + `,"intent":"` + intent + `"}]`
	}
	noSmoking, luggage := tagID(t, tx, "不抽菸"), tagID(t, tx, "可載行李")
	for _, c := range []struct {
		name, extra, code string
	}{
		{"preferred intent", filter(noSmoking, "preferred"), "intent_not_allowed"},
		{"driver-only tag", filter(luggage, "required"), "tag_not_applicable"},
	} {
		_, token := newUser(t, tx, roleDriver)
		wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark, c.extra)),
			http.StatusBadRequest, c.code)
	}

	_, token := newUser(t, tx, roleDriver)
	w := call(t, tx, http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark, filter(noSmoking, "required")))
	wantStatus(t, w, http.StatusCreated, "")
	var intent string
	if err := tx.QueryRow(context.Background(), `SELECT intent FROM trip_tag_filters WHERE trip_id = $1 AND tag_id = $2`,
		decode[tripResp](t, w).ID, noSmoking).Scan(&intent); err != nil || intent != "required" {
		t.Errorf("stored filter = %q (%v), want required", intent, err)
	}
}

// REQ-085: the passenger filters the supply and the request only by tags that apply to drivers.
func TestPassengerFiltersOnlyByDriverTags(t *testing.T) {
	e := newSupplyEnv(t)
	luggage := tagID(t, e.tx, "可載行李")
	passengerTag := passengerOnlyTag(t, e.tx)
	e.addTrip(t, tripSpec{tagIDs: []int64{luggage}})

	// 能放大件行李 is a driver tag: both the supply query and the request take it.
	if got := e.supply(t, map[string]string{"required_tags": itoa(luggage)}); len(got.Cars) != 1 {
		t.Errorf("supply with 可載行李 = %v, want the one car", carIDs(got))
	}
	for _, key := range []string{"required_tags", "preferred_tags"} {
		wantStatus(t, call(t, e.tx, http.MethodGet, e.query(map[string]string{key: itoa(passengerTag)}), e.token, ""),
			http.StatusBadRequest, "tag_not_applicable")
	}

	for _, intent := range []string{"required", "preferred"} {
		bad := `"tag_filters":[{"tag_id":` + itoa(passengerTag) + `,"intent":"` + intent + `"}]`
		wantStatus(t, call(t, e.tx, http.MethodPost, "/api/passenger/requests", e.token, e.body(e.near(), bad)),
			http.StatusBadRequest, "tag_not_applicable")
	}
	good := `"tag_filters":[{"tag_id":` + itoa(luggage) + `,"intent":"required"}]`
	e.submit(t, e.near(), &good)
}

// DD-42, REQ-013: the database refuses a driver's suggested filter and a label for a side the
// tag does not apply to.
func TestTagConstraints(t *testing.T) {
	tx := testTx(t)
	driverID, _ := newUser(t, tx, roleDriver)
	var tripID int64
	if err := tx.QueryRow(context.Background(), `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status)
		VALUES ($1, $2, 'x', 25.08, 121.57, 3, 'completed') RETURNING id`, driverID, firstPickupID(t, tx)).Scan(&tripID); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO trip_tag_filters (trip_id, tag_id, intent) SELECT ` + itoa(tripID) + `, id, 'preferred' FROM tags WHERE name = '可聊天'`,
		`UPDATE tags SET passenger_self_label = '我能放行李' WHERE name = '可載行李'`,
		`UPDATE tags SET driver_filter_label = '能放行李的乘客' WHERE name = '可載行李'`,
		`UPDATE tags SET driver_self_label = NULL WHERE name = '不抽菸'`,
		`UPDATE tags SET passenger_filter_label = NULL WHERE name = '不抽菸'`,
	} {
		sp, err := tx.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sp.Exec(context.Background(), sql); err == nil || !strings.Contains(err.Error(), "check constraint") {
			t.Errorf("%s: err = %v, want a check violation", sql, err)
		}
		_ = sp.Rollback(context.Background())
	}
	mustExec(t, tx, `INSERT INTO trip_tag_filters (trip_id, tag_id, intent) SELECT $1, id, 'required' FROM tags WHERE name = '可聊天'`, tripID)
}
