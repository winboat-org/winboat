package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func validateApp(w http.ResponseWriter, r *http.Request) {
	var target struct {
		Path string `json:"path"`
		Args string `json:"args"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&target); err != nil || target.Path == "" {
		http.Error(w, "A valid application target is required", http.StatusBadRequest)
		return
	}
	if pathHasUNCOrControlChars(target.Path) {
		http.Error(w, "Unsupported application path", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	input, err := json.Marshal(target)
	if err != nil {
		http.Error(w, "Invalid application target", http.StatusBadRequest)
		return
	}
	command := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "./scripts/validate-app.ps1")
	command.Stdin = bytes.NewReader(input)
	output, err := command.Output()
	if err != nil {
		http.Error(w, "Could not verify application target", http.StatusServiceUnavailable)
		return
	}
	status := strings.TrimSpace(string(output))
	if status != "valid" && status != "missing" && status != "unknown" {
		http.Error(w, "Unexpected application validation response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": status})
}
