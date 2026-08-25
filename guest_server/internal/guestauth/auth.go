// Package guestauth authenticates Guest Server requests with a shared
// bearer token and loopback-only Host headers to prevent DNS rebinding.
package guestauth

import (
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// TokenPath returns the shared token path, one level above the service binary.
func TokenPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exe), "..", "guest_token"), nil
}

// LoadToken reads and trims the shared guest token from disk.
func LoadToken() (string, error) {
	p, err := TokenPath()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}

var loopbackHosts = map[string]struct{}{
	"127.0.0.1": {},
	"localhost": {},
	"::1":       {},
}

// hostAllowed ignores the port because host forwarding changes it.
func hostAllowed(host string) bool {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		h = host
	}
	h = strings.TrimSuffix(strings.TrimPrefix(h, "["), "]")
	_, ok := loopbackHosts[h]
	return ok
}

func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

// Authorized requires a loopback Host and matching bearer token.
func Authorized(r *http.Request, token string) bool {
	if token == "" || !hostAllowed(r.Host) {
		return false
	}
	got := bearerToken(r)
	if got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(token)) == 1
}

// Middleware wraps a handler, rejecting any request that fails Authorized.
func Middleware(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !Authorized(r, token) {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
