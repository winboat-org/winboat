package main

import (
	"strings"
	"unicode"
)

// isSafeIconPath rejects remote UNC paths and control characters. The icon
// script only needs local Windows filesystem paths.
func isSafeIconPath(path string) bool {
	if strings.HasPrefix(path, `\\`) || strings.HasPrefix(path, "//") {
		return false
	}
	return !strings.ContainsFunc(path, unicode.IsControl)
}
