//go:build !windows

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func fakePowerShell(t *testing.T) (string, string) {
	t.Helper()
	directory := t.TempDir()
	argumentsFile, inputFile := filepath.Join(directory, "args"), filepath.Join(directory, "input")
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("WB_TEST_ARGS", argumentsFile)
	t.Setenv("WB_TEST_INPUT", inputFile)
	t.Setenv("WB_TEST_STATUS", "valid")
	t.Setenv("WB_TEST_EXIT", "0")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$WB_TEST_ARGS\"\ncat > \"$WB_TEST_INPUT\"\nprintf '%s\\n' \"$WB_TEST_STATUS\"\nexit \"$WB_TEST_EXIT\"\n"
	if err := os.WriteFile(filepath.Join(directory, "powershell"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return argumentsFile, inputFile
}

func TestValidateAppPassesTargetsAsJSONNotPowerShell(t *testing.T) {
	argumentsFile, inputFile := fakePowerShell(t)
	target := map[string]string{
		"path": `C:\Apps\O’Brien's 日本語\tool.exe`,
		"args": "‘; Write-Output injected; # ’ \"quoted\" `literal` $(Get-Process)\nnext line",
	}
	body, err := json.Marshal(target)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	validateApp(recorder, httptest.NewRequest(http.MethodPost, "/apps/validate", strings.NewReader(string(body))))
	if recorder.Code != http.StatusOK || strings.TrimSpace(recorder.Body.String()) != `{"status":"valid"}` {
		t.Fatalf("code=%d body=%q", recorder.Code, recorder.Body.String())
	}
	arguments, err := os.ReadFile(argumentsFile)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "./scripts/validate-app.ps1"}
	if got := strings.Split(strings.TrimSpace(string(arguments)), "\n"); !reflect.DeepEqual(got, want) {
		t.Fatalf("PowerShell arguments = %q, want fixed script invocation %q", got, want)
	}
	input, err := os.ReadFile(inputFile)
	if err != nil {
		t.Fatal(err)
	}
	var received map[string]string
	if err := json.Unmarshal(input, &received); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(received, target) {
		t.Fatalf("stdin changed the target: got %q, want %q", received, target)
	}
}

func TestValidateAppRejectsInvalidTargetsWithoutStartingPowerShell(t *testing.T) {
	_, inputFile := fakePowerShell(t)
	for _, body := range []string{
		`{`, `{}`, `{"path":42}`, `{"path":"\\\\server\\app.exe"}`,
		`{"path":"/\\server/app.exe"}`, `{"path":"C:\\app\n.exe"}`,
		`{"path":"C:\\app.exe","args":"` + strings.Repeat("a", 16384) + `"}`,
	} {
		recorder := httptest.NewRecorder()
		validateApp(recorder, httptest.NewRequest(http.MethodPost, "/apps/validate", strings.NewReader(body)))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("code=%d, want bad request", recorder.Code)
		}
	}
	if _, err := os.Stat(inputFile); !os.IsNotExist(err) {
		t.Fatal("invalid input reached PowerShell")
	}
}

func TestValidateAppDoesNotReportFailuresAsMissing(t *testing.T) {
	fakePowerShell(t)
	for _, test := range []struct {
		status string
		exit   string
		code   int
	}{
		{"missing", "0", http.StatusOK},
		{"unknown", "0", http.StatusOK},
		{"unexpected output", "0", http.StatusInternalServerError},
		{"missing", "1", http.StatusServiceUnavailable},
	} {
		t.Run(test.status+test.exit, func(t *testing.T) {
			t.Setenv("WB_TEST_STATUS", test.status)
			t.Setenv("WB_TEST_EXIT", test.exit)
			recorder := httptest.NewRecorder()
			validateApp(recorder, httptest.NewRequest(http.MethodPost, "/apps/validate", strings.NewReader(`{"path":"C:\\app.exe"}`)))
			if recorder.Code != test.code {
				t.Fatalf("code=%d, want %d; body=%q", recorder.Code, test.code, recorder.Body.String())
			}
		})
	}
}
