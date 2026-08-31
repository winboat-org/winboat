//go:build windows

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/shirou/gopsutil/cpu"
	"github.com/shirou/gopsutil/disk"
	"github.com/shirou/gopsutil/mem"

	"winboat-guest/internal/guestauth"
)

var (
	Version        = "0.0.0"
	CommitHash     = "n/a"
	BuildTimestamp = "n/a"
)

const (
	appsRequestTimeout        = 30 * time.Second
	projectedAppsTimeout      = 10 * time.Second
	maxAppsResponseBytes      = 8 << 20
	maxProjectedResponseBytes = 256 << 10
)

type Metrics struct {
	CPU struct {
		Usage     float64 `json:"usage"`     // Percentage, 0-100
		Frequency uint64  `json:"frequency"` // MHz
	} `json:"cpu"`
	RAM struct {
		Used       uint64  `json:"used"`       // MB
		Total      uint64  `json:"total"`      // MB
		Percentage float64 `json:"percentage"` // %
	} `json:"ram"`
	Disk struct {
		Used       uint64  `json:"used"`       // MB
		Total      uint64  `json:"total"`      // MB
		Percentage float64 `json:"percentage"` // %
	} `json:"disk"`
}

type RDPStatusResponse struct {
	RdpConnection bool `json:"rdpConnected"`
}

func getApps(w http.ResponseWriter, r *http.Request) {
	query, err := parseAppsRawQuery(r.URL.RawQuery)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	script := ".\\scripts\\apps.ps1"
	timeout := appsRequestTimeout
	maxResponseBytes := maxAppsResponseBytes
	var args []string
	if query.projected {
		script = ".\\scripts\\apps-query.ps1"
		timeout = projectedAppsTimeout
		maxResponseBytes = maxProjectedResponseBytes
		args = query.powerShellArgs()
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	var output []byte
	if query.projected {
		output, err = executePowerShellScriptWithNamedArgsContextBounded(ctx, script, maxResponseBytes, args...)
	} else {
		output, err = executePowerShellScriptContextBounded(ctx, script, true, maxResponseBytes)
	}
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			http.Error(w, "App discovery timed out", http.StatusGatewayTimeout)
			return
		}
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if len(output) > maxResponseBytes {
		http.Error(w, "App discovery response exceeds the safe size limit", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(output)
}

func getHealth(w http.ResponseWriter, r *http.Request) {
	response := struct {
		Status         string   `json:"status"`
		APIVersion     int      `json:"apiVersion"`
		Authentication string   `json:"authentication"`
		Capabilities   []string `json:"capabilities"`
	}{
		Status:         "ok",
		APIVersion:     1,
		Authentication: "bearer",
		Capabilities:   []string{appsQueryCapability},
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func getVersion(w http.ResponseWriter, r *http.Request) {
	response := map[string]string{
		"version":     Version,
		"commit_hash": CommitHash,
		"build_time":  BuildTimestamp,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func getMetrics(w http.ResponseWriter, r *http.Request) {
	cpuPercent, err := cpu.Percent(time.Second/4, false)
	if err != nil {
		http.Error(w, "Failed to get CPU stats: "+err.Error(), http.StatusInternalServerError)
		return
	}
	cpuInfo, err := cpu.Info()
	if err != nil || len(cpuInfo) == 0 {
		http.Error(w, "Failed to get CPU info: "+err.Error(), http.StatusInternalServerError)
		return
	}

	memInfo, err := mem.VirtualMemory()
	if err != nil {
		http.Error(w, "Failed to get RAM stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	diskInfo, err := disk.Usage("C:\\")
	if err != nil {
		http.Error(w, "Failed to get disk stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	metrics := Metrics{}
	metrics.CPU.Usage = cpuPercent[0]
	metrics.CPU.Frequency = uint64(cpuInfo[0].Mhz)
	metrics.RAM.Used = memInfo.Used / 1024 / 1024
	metrics.RAM.Total = memInfo.Total / 1024 / 1024
	metrics.RAM.Percentage = float64(metrics.RAM.Used) / float64(metrics.RAM.Total) * 100
	metrics.Disk.Used = diskInfo.Used / 1024 / 1024
	metrics.Disk.Total = diskInfo.Total / 1024 / 1024
	metrics.Disk.Percentage = diskInfo.UsedPercent

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metrics)
}

func getRdpConnectedStatus(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("quser.exe")
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// TODO: Check for VNC sessions.
	hasRdpSession := strings.Contains(strings.ToLower(string(output)), "active") &&
		strings.Contains(strings.ToLower(string(output)), "rdp")

	response := RDPStatusResponse{
		RdpConnection: hasRdpSession,
	}

	jsonResponse, err := json.Marshal(response)
	if err != nil {
		http.Error(w, "Failed to marshal JSON response: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResponse)
}

func getIcon(w http.ResponseWriter, r *http.Request) {
	path := r.PostFormValue("path")
	if path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}
	if !isSafeIconPath(path) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	output, err := executePowerShellScript("scripts\\get-icon.ps1", false, "-path", path)
	if err != nil {
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write(output)
}

func main() {
	token, err := guestauth.LoadToken()
	if err != nil {
		log.Fatalf("Failed to load guest token: %v", err)
	}
	if token == "" {
		log.Fatal("Failed to load guest token: token is empty")
	}

	auth := guestauth.Middleware(token)
	protected := func(handler http.HandlerFunc) http.Handler {
		return auth(handler)
	}

	r := mux.NewRouter()
	r.Handle("/apps", protected(getApps)).Methods("GET")
	r.HandleFunc("/health", getHealth).Methods("GET")
	r.Handle("/version", protected(getVersion)).Methods("GET")
	r.Handle("/metrics", protected(getMetrics)).Methods("GET")
	r.Handle("/rdp/status", protected(getRdpConnectedStatus)).Methods("GET")
	r.Handle("/get-icon", protected(getIcon)).Methods("POST")

	srv := &http.Server{
		Addr:              ":7148",
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Println("Starting WinBoat Guest Server on :7148...")
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal("Server failed: ", err)
	}
}
