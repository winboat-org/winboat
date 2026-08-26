package main

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode"
)

const (
	appsQueryCapability = "apps-query-v1"
	defaultAppsLimit    = 128
	maxAppsLimit        = 128
	maxAppsPathBytes    = 4096
)

var projectedAppFields = map[string]string{
	"name":   "Name",
	"path":   "Path",
	"source": "Source",
}

var appsQueryParameters = map[string]struct{}{
	"includeIcons": {},
	"pathPrefix":   {},
	"pathSuffix":   {},
	"fields":       {},
	"limit":        {},
}

type appsQuery struct {
	projected  bool
	pathPrefix string
	pathSuffix string
	fields     []string
	limit      int
}

func parseAppsQuery(values url.Values) (appsQuery, error) {
	query := appsQuery{}
	known := false
	for _, key := range []string{"includeIcons", "pathPrefix", "pathSuffix", "fields", "limit"} {
		if values.Has(key) {
			known = true
			break
		}
	}
	if !known {
		return query, nil
	}
	for key, entries := range values {
		if _, ok := appsQueryParameters[key]; !ok {
			return appsQuery{}, errors.New("projected app query contains an unsupported parameter")
		}
		if len(entries) != 1 {
			return appsQuery{}, errors.New("projected app query parameters must not be repeated")
		}
	}

	includeIcons, err := strconv.ParseBool(values.Get("includeIcons"))
	if err != nil || includeIcons {
		return appsQuery{}, errors.New("includeIcons=false is required for projected app queries")
	}
	pathPrefix := values.Get("pathPrefix")
	pathSuffix := values.Get("pathSuffix")
	if !isSafeWindowsRoot(pathPrefix) {
		return appsQuery{}, errors.New("pathPrefix must be a bounded local absolute Windows path")
	}
	if !isSafeRelativeWindowsSuffix(pathSuffix) {
		return appsQuery{}, errors.New("pathSuffix must be a bounded relative Windows path")
	}
	fields, err := parseProjectedFields(values.Get("fields"))
	if err != nil {
		return appsQuery{}, err
	}
	limit := defaultAppsLimit
	if rawLimit := values.Get("limit"); rawLimit != "" {
		limit, err = strconv.Atoi(rawLimit)
		if err != nil || limit < 1 || limit > maxAppsLimit {
			return appsQuery{}, errors.New("limit must be between 1 and 128")
		}
	}

	return appsQuery{
		projected:  true,
		pathPrefix: pathPrefix,
		pathSuffix: pathSuffix,
		fields:     fields,
		limit:      limit,
	}, nil
}

func parseProjectedFields(raw string) ([]string, error) {
	if raw == "" {
		return nil, errors.New("fields is required for projected app queries")
	}
	seen := make(map[string]struct{})
	fields := make([]string, 0, len(projectedAppFields))
	for _, rawField := range strings.Split(raw, ",") {
		field, ok := projectedAppFields[strings.ToLower(strings.TrimSpace(rawField))]
		if !ok {
			return nil, errors.New("fields contains an unsupported projection")
		}
		if _, duplicate := seen[field]; duplicate {
			return nil, errors.New("fields contains a duplicate projection")
		}
		seen[field] = struct{}{}
		fields = append(fields, field)
	}
	if _, ok := seen["Path"]; !ok {
		return nil, errors.New("fields must include Path")
	}
	return fields, nil
}

func isSafeWindowsRoot(value string) bool {
	if len(value) < 3 || len(value) > maxAppsPathBytes || !isASCIIAlpha(value[0]) || value[1] != ':' || !isPathSeparator(value[2]) {
		return false
	}
	return safeWindowsPathComponents(value[3:])
}

func isSafeRelativeWindowsSuffix(value string) bool {
	if len(value) < 2 || len(value) > maxAppsPathBytes || !isPathSeparator(value[0]) {
		return false
	}
	return safeWindowsPathComponents(value[1:])
}

func safeWindowsPathComponents(value string) bool {
	if value == "" || strings.ContainsAny(value, "*?\"") || strings.ContainsRune(value, ':') || strings.ContainsFunc(value, unicode.IsControl) {
		return false
	}
	components := strings.FieldsFunc(value, func(r rune) bool { return r == '\\' || r == '/' })
	if len(components) == 0 {
		return false
	}
	for _, component := range components {
		if component == "." || component == ".." || strings.TrimSpace(component) == "" {
			return false
		}
	}
	return true
}

func isASCIIAlpha(value byte) bool {
	return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z'
}

func isPathSeparator(value byte) bool {
	return value == '\\' || value == '/'
}

func (query appsQuery) powerShellArgs() []string {
	return []string{
		"-PathPrefix", query.pathPrefix,
		"-PathSuffix", query.pathSuffix,
		"-Fields", strings.Join(query.fields, ","),
		"-Limit", strconv.Itoa(query.limit),
	}
}
