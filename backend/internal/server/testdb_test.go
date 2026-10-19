package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/sohoffice/debugthon-carpool/backend/internal/park"
)

func testDatabaseURL() string {
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		return url
	}
	return "postgres://carpool:carpool@localhost:5432/carpool?sslmode=disable"
}

// testDeps loads the real park boundary and routes in a straight line, so tests never reach out.
func testDeps(t *testing.T) Deps {
	t.Helper()
	boundary, err := park.Load("../../config/park/boundary.geojson")
	if err != nil {
		t.Fatal(err)
	}
	return Deps{Park: boundary, Routes: straightRoute{}}
}

// testTx opens a transaction on the local database and rolls it back when the
// test ends, so fixtures never leak. Needs `just infra up` and `just backend db-apply`.
func testTx(t *testing.T) pgx.Tx {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDatabaseURL())
	if err != nil {
		t.Fatalf("connect database (run `just infra up` and `just backend db-apply`): %v", err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = tx.Rollback(ctx)
		_ = conn.Close(ctx)
	})
	return tx
}

func mustExec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// call sends a request through the router; token "" means no Authorization header.
func call(t *testing.T, db DB, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	NewRouter(db, testDeps(t)).ServeHTTP(w, req)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return v
}

type errBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", w.Code, status, w.Body.String())
	}
	if code != "" {
		if got := decode[errBody](t, w).Error.Code; got != code {
			t.Fatalf("error code = %q, want %q", got, code)
		}
	}
}
