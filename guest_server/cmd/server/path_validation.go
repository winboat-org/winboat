package main

import (
	"strings"
	"unicode"
)

func pathHasUNCOrControlChars(path string) bool {
	return strings.HasPrefix(strings.ReplaceAll(path, "/", `\`), `\\`) ||
		strings.ContainsFunc(path, unicode.IsControl)
}
