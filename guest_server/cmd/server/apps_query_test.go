package main

import (
	"net/url"
	"reflect"
	"testing"
)

func TestParseAppsQuery(t *testing.T) {
	tests := []struct {
		name      string
		values    url.Values
		projected bool
		wantErr   bool
	}{
		{name: "legacy request", values: url.Values{}},
		{
			name: "bounded projection",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`C:\Program Files\Mendix\`},
				"pathSuffix":   {`\modeler\studiopro.exe`},
				"fields":       {"Name,Path,Source"},
				"limit":        {"64"},
			},
			projected: true,
		},
		{
			name: "icons cannot be requested",
			values: url.Values{
				"includeIcons": {"true"},
				"pathPrefix":   {`C:\Apps\`},
				"pathSuffix":   {`\app.exe`},
				"fields":       {"Path"},
			},
			wantErr: true,
		},
		{
			name: "UNC root",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`\\server\share`},
				"pathSuffix":   {`\app.exe`},
				"fields":       {"Path"},
			},
			wantErr: true,
		},
		{
			name: "relative traversal",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`C:\Apps\`},
				"pathSuffix":   {`\..\secret.exe`},
				"fields":       {"Path"},
			},
			wantErr: true,
		},
		{
			name: "unknown field",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`C:\Apps\`},
				"pathSuffix":   {`\app.exe`},
				"fields":       {"Path,Icon"},
			},
			wantErr: true,
		},
		{
			name: "oversized limit",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`C:\Apps\`},
				"pathSuffix":   {`\app.exe`},
				"fields":       {"Path"},
				"limit":        {"129"},
			},
			wantErr: true,
		},
		{
			name: "unknown parameter",
			values: url.Values{
				"includeIcons": {"false"},
				"pathPrefix":   {`C:\Apps\`},
				"pathSuffix":   {`\app.exe`},
				"fields":       {"Path"},
				"command":      {"whoami"},
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			query, err := parseAppsQuery(test.values)
			if (err != nil) != test.wantErr {
				t.Fatalf("parseAppsQuery() error = %v, wantErr %v", err, test.wantErr)
			}
			if query.projected != test.projected {
				t.Fatalf("parseAppsQuery() projected = %v, want %v", query.projected, test.projected)
			}
		})
	}
}

func TestProjectedQueryPowerShellArgumentsStaySeparated(t *testing.T) {
	query, err := parseAppsQuery(url.Values{
		"includeIcons": {"false"},
		"pathPrefix":   {`C:\Program Files\Mendix\`},
		"pathSuffix":   {`\modeler\studiopro.exe`},
		"fields":       {"Name,Path,Source"},
		"limit":        {"64"},
	})
	if err != nil {
		t.Fatalf("parse query: %v", err)
	}
	want := []string{
		"-PathPrefix", `C:\Program Files\Mendix\`,
		"-PathSuffix", `\modeler\studiopro.exe`,
		"-Fields", "Name,Path,Source",
		"-Limit", "64",
	}
	if got := query.powerShellArgs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("powerShellArgs() = %#v, want %#v", got, want)
	}
}
