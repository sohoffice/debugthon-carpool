package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeEnv(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

// layout makes grand/parent/cwd and returns cwd and parent.
func layout(t *testing.T) (cwd, parent string) {
	t.Helper()
	parent = filepath.Join(t.TempDir(), "parent")
	cwd = filepath.Join(parent, "cwd")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	return cwd, parent
}

func TestLoadEnvFileLookup(t *testing.T) {
	t.Run("the working directory wins and the parent is not merged", func(t *testing.T) {
		cwd, parent := layout(t)
		writeEnv(t, cwd, "T23_FROM_CWD=cwd\n")
		writeEnv(t, parent, "T23_FROM_CWD=parent\nT23_PARENT_ONLY=parent\n")
		t.Setenv("T23_FROM_CWD", "")
		os.Unsetenv("T23_FROM_CWD")
		os.Unsetenv("T23_PARENT_ONLY")
		loadEnvFile(cwd)
		if got := os.Getenv("T23_FROM_CWD"); got != "cwd" {
			t.Errorf("T23_FROM_CWD = %q, want the working directory's value", got)
		}
		if _, ok := os.LookupEnv("T23_PARENT_ONLY"); ok {
			t.Error("the parent's .env was loaded too; only the first one found may be")
		}
	})
	t.Run("falls back to the parent", func(t *testing.T) {
		cwd, parent := layout(t)
		writeEnv(t, parent, "T23_PARENT_ONLY=parent\n")
		os.Unsetenv("T23_PARENT_ONLY")
		t.Cleanup(func() { os.Unsetenv("T23_PARENT_ONLY") })
		loadEnvFile(cwd)
		if got := os.Getenv("T23_PARENT_ONLY"); got != "parent" {
			t.Errorf("T23_PARENT_ONLY = %q, want the parent's value", got)
		}
	})
	t.Run("does not look above the parent", func(t *testing.T) {
		cwd, parent := layout(t)
		writeEnv(t, filepath.Dir(parent), "T23_GRANDPARENT=grand\n")
		os.Unsetenv("T23_GRANDPARENT")
		loadEnvFile(cwd)
		if _, ok := os.LookupEnv("T23_GRANDPARENT"); ok {
			t.Error("a .env two levels up was loaded")
		}
	})
	t.Run("no file loads nothing and is not an error", func(t *testing.T) {
		cwd, _ := layout(t)
		loadEnvFile(cwd) // log.Fatal would end the test binary
	})
	t.Run("the environment wins, even when empty", func(t *testing.T) {
		cwd, _ := layout(t)
		writeEnv(t, cwd, "T23_EMPTY=file\n")
		t.Setenv("T23_EMPTY", "")
		loadEnvFile(cwd)
		if got, ok := os.LookupEnv("T23_EMPTY"); !ok || got != "" {
			t.Errorf("T23_EMPTY = %q (set %v), want the empty value kept", got, ok)
		}
	})
}
