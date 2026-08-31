//go:build windows

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAppsHandlerRejectsInvalidQueriesBeforeExecution(t *testing.T) {
	for _, rawQuery := range []string{
		"command=whoami",
		"includeIcons=false&pathPrefix=%zz",
		"includeIcons=true&pathPrefix=C%3A%5CApps%5C&pathSuffix=%5Capp.exe&fields=Path",
	} {
		request := httptest.NewRequest(http.MethodGet, "/apps?"+rawQuery, nil)
		response := httptest.NewRecorder()

		getApps(response, request)

		if response.Code != http.StatusBadRequest {
			t.Fatalf("GET /apps?%s status = %d, want %d", rawQuery, response.Code, http.StatusBadRequest)
		}
	}
}

func TestHealthAdvertisesTheVersionedAppsCapability(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	getHealth(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("GET /health status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Status         string   `json:"status"`
		APIVersion     int      `json:"apiVersion"`
		Authentication string   `json:"authentication"`
		Capabilities   []string `json:"capabilities"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode GET /health response: %v", err)
	}
	if payload.Status != "ok" ||
		payload.APIVersion != 1 ||
		payload.Authentication != "bearer" ||
		len(payload.Capabilities) != 1 ||
		payload.Capabilities[0] != appsQueryCapability {
		t.Fatalf("unexpected GET /health response: %#v", payload)
	}
}
