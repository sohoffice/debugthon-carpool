package server

import (
	"context"
	"net/http"
	"net/url"
	"testing"
)

func searchPlacesCall(t *testing.T, db DB, token, q string) []placeView {
	t.Helper()
	w := call(t, db, http.MethodGet, "/api/places?q="+url.QueryEscape(q), token, "")
	wantStatus(t, w, http.StatusOK, "")
	return decode[[]placeView](t, w)
}

// DD-28, REQ-001: every place in the list is inside the park.
func TestEveryPlaceIsInsideThePark(t *testing.T) {
	tx := testTx(t)
	boundary := testDeps(t).Park
	rows, err := tx.Query(context.Background(), `SELECT name, lat, lng FROM places`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var name string
		var lat, lng float64
		if err := rows.Scan(&name, &lat, &lng); err != nil {
			t.Fatal(err)
		}
		n++
		if !boundary.Contains(lat, lng) {
			t.Errorf("place %q (%v, %v) is outside the park", name, lat, lng)
		}
	}
	if n == 0 {
		t.Fatal("places is empty")
	}
}

// DD-28, REQ-024: part of the name or of the address finds a place; matching ignores case.
func TestSearchPlacesByNameAndAddress(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	mustExec(t, tx, `INSERT INTO places (name, address, lat, lng) VALUES ('Zeta Tower', '台北市內湖區測試路99號', 25.0768, 121.5738)`)

	for _, q := range []string{"Zeta", "eta tow", "ZETA TOWER", "測試路99"} {
		got := searchPlacesCall(t, tx, token, q)
		if len(got) != 1 || got[0].Name != "Zeta Tower" || got[0].Address != "台北市內湖區測試路99號" || got[0].Lat != 25.0768 || got[0].Lng != 121.5738 {
			t.Errorf("q=%q: got %+v, want only Zeta Tower with its address and coordinates", q, got)
		}
	}
	if got := searchPlacesCall(t, tx, token, "no-such-place-xyz"); len(got) != 0 {
		t.Errorf("unmatched keyword returned %+v, want an empty list", got)
	}
}

// DD-28: at most 8 results, so 8 matches are all returned and a 9th is cut.
func TestSearchPlacesReturnsAtMostEight(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	for i := 1; i <= 9; i++ {
		mustExec(t, tx, `INSERT INTO places (name, address, lat, lng) VALUES ($1, 'x', 25.0768, 121.5738)`, "Cap place "+itoa(int64(i)))
		if want := min(i, 8); len(searchPlacesCall(t, tx, token, "Cap place")) != want {
			t.Fatalf("with %d matches got %d results, want %d", i, len(searchPlacesCall(t, tx, token, "Cap place")), want)
		}
	}
}

// A keyword is literal text: % and _ are not wildcards.
func TestSearchPlacesTreatsWildcardsAsText(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	if got := searchPlacesCall(t, tx, token, "%"); len(got) != 0 {
		t.Errorf("q=%% matched %+v, want nothing", got)
	}
}

func TestSearchPlacesRejections(t *testing.T) {
	tx := testTx(t)
	_, driver := newUser(t, tx, roleDriver)
	_, passenger := newUser(t, tx, rolePassenger)

	wantStatus(t, call(t, tx, http.MethodGet, "/api/places", driver, ""), http.StatusBadRequest, "invalid_request")
	wantStatus(t, call(t, tx, http.MethodGet, "/api/places?q=%20%20", driver, ""), http.StatusBadRequest, "invalid_request")
	wantStatus(t, call(t, tx, http.MethodGet, "/api/places?q=a", "", ""), http.StatusUnauthorized, "")
	// both roles may search
	if got := searchPlacesCall(t, tx, passenger, "內科"); len(got) == 0 {
		t.Error("passenger search found nothing in the seed data")
	}
}
