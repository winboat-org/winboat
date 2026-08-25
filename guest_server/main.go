//go:build windows
// +build windows

package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gorilla/mux"
	"github.com/rs/cors"
	"github.com/shirou/gopsutil/cpu"
	"github.com/shirou/gopsutil/disk"
	"github.com/shirou/gopsutil/mem"
)

var (
	Version        = "0.0.0"
	CommitHash     = "n/a"
	BuildTimestamp = "n/a"
)

const AUTHKEY_HASH_REG = "WinBoatAuthHash"
const AUTHKEY_HASH_OEM_LOCATION = "C:\\OEM\\auth.hash"

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
	cmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & '.\\scripts\\apps.ps1'")
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(output)
}

func getHealth(w http.ResponseWriter, r *http.Request) {
	// Simple health check
	response := map[string]string{"status": "ok"}
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
	// CPU stats
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

	// RAM stats
	memInfo, err := mem.VirtualMemory()
	if err != nil {
		http.Error(w, "Failed to get RAM stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Disk stats (using first disk, adjust path if needed)
	diskInfo, err := disk.Usage("C:\\")
	if err != nil {
		http.Error(w, "Failed to get disk stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build metrics struct
	metrics := Metrics{}
	metrics.CPU.Usage = cpuPercent[0]              // Total CPU usage
	metrics.CPU.Frequency = uint64(cpuInfo[0].Mhz) // First CPU's frequency
	metrics.RAM.Used = memInfo.Used / 1024 / 1024  // Bytes to MB
	metrics.RAM.Total = memInfo.Total / 1024 / 1024
	metrics.RAM.Percentage = float64(metrics.RAM.Used) / float64(metrics.RAM.Total) * 100
	metrics.Disk.Used = diskInfo.Used / 1024 / 1024
	metrics.Disk.Total = diskInfo.Total / 1024 / 1024
	metrics.Disk.Percentage = diskInfo.UsedPercent

	// Send it
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(metrics)
}

func getRdpConnectedStatus(w http.ResponseWriter, r *http.Request) {
	// Check for RDP Status via quser.exe
	cmd := exec.Command("quser.exe")
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}
	// Check if the output contains both "active" and "rdp" todo: Check for VNC Sessions
	hasRdpSession := strings.Contains(strings.ToLower(string(output)), "active") &&
		strings.Contains(strings.ToLower(string(output)), "rdp")

	response := RDPStatusResponse{
		RdpConnection: hasRdpSession,
	}

	// Convert the response from guest server to JSON
	// Expected output { "rdp_connected": "true" } if a session is active
	jsonResponse, err := json.Marshal(response)
	if err != nil {
		http.Error(w, "Failed to marshal JSON response: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(jsonResponse)
}

func isSafeIconPath(path string) bool {
	if strings.HasPrefix(path, `\\`) || strings.HasPrefix(path, "//") {
		return false
	}
	return !strings.ContainsFunc(path, unicode.IsControl)
}

func applyUpdate(w http.ResponseWriter, r *http.Request) {
	// Verify password
	expectedHash, err := getSecureRegKey(AUTHKEY_HASH_REG)
	if err != nil || expectedHash == nil {
		http.Error(w, "Unauthorized: failed to read auth hash", http.StatusUnauthorized)
		return
	}

	password := r.FormValue("password")
	if password == "" {
		http.Error(w, "Unauthorized: password is required", http.StatusUnauthorized)
		return
	}

	isValid, err := verifyPasswordSecure(*expectedHash, password)
	if err != nil || !isValid {
		http.Error(w, "Unauthorized: invalid password", http.StatusUnauthorized)
		return
	}

	r.ParseMultipartForm(100 << 20) // Limit upload size to 100MB
	var buf bytes.Buffer

	// Grab the file
	file, _, err := r.FormFile("updateFile")
	if err != nil {
		http.Error(w, "Failed to get update file: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Copy to buffer & close the file
	io.Copy(&buf, file)
	file.Close()

	// Check zip magic bytes
	if !(buf.Bytes()[0] == 'P' && buf.Bytes()[1] == 'K' && buf.Bytes()[2] == 3 && buf.Bytes()[3] == 4) {
		http.Error(w, "Uploaded file is not a valid ZIP archive", http.StatusBadRequest)
		return
	}

	// Make temp directory
	tmpDir, err := os.MkdirTemp("", "winboat-update")
	if err != nil {
		http.Error(w, "Failed to create temp directory: "+err.Error(), http.StatusInternalServerError)
	}

	// Write to temp file
	fileName := "update.zip"
	tmpFilePath := filepath.Join(tmpDir, fileName)
	err = os.WriteFile(tmpFilePath, buf.Bytes(), 0644)

	if err != nil {
		http.Error(w, "Failed to write temp file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get current executable path & directory
	exePath, err := os.Executable()
	if err != nil {
		http.Error(w, "Failed to get executable path: "+err.Error(), http.StatusInternalServerError)
		return
	}
	appDir := filepath.Dir(exePath)
	origScriptPath := filepath.Join(appDir, "scripts\\update.ps1")
	scriptPath := filepath.Join(tmpDir, "update.ps1")

	// Copy the update script to the temp directory
	copyFile(origScriptPath, scriptPath)

	// Return success & the paths
	response := map[string]string{
		"status":    "updating",
		"temp_path": tmpFilePath,
		"filename":  fileName,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)

	// Create & run the script
	cmd := exec.Command("cmd", "/C", "start", "/B", "powershell",
		"-ExecutionPolicy", "Bypass", "-File", scriptPath,
		"-AppPath", appDir,
		"-UpdateFilePath", tmpFilePath,
		"-ServiceName", "WinBoatGuestServer")

	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil

	// The script will take care of the rest, including stopping this service
	cmd.Start()

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

	cmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-File", "scripts\\get-icon.ps1", "-path", path)
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, "Failed to execute script: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write(output)
}

func setAuthHash(w http.ResponseWriter, r *http.Request) {
	// If there's an existing hash, reject
	existingHash, err := getSecureRegKey(AUTHKEY_HASH_REG)
	if err != nil {
		http.Error(w, "Failed to read existing auth hash: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if existingHash != nil {
		http.Error(w, "Auth hash already set", http.StatusBadRequest)
		return
	}

	// Get auth hash from POST body
	authHash := r.PostFormValue("authHash")
	if authHash == "" {
		http.Error(w, "authHash is required", http.StatusBadRequest)
		return
	}

	// Store it securely
	err = setSecureRegKey(AUTHKEY_HASH_REG, authHash)
	if err != nil {
		http.Error(w, "Failed to store auth hash: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Success
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	response := map[string]string{"status": "ok"}
	json.NewEncoder(w).Encode(response)
}

func main() {
	// Try to initialize auth key hash if not present
	existingHash, err := getSecureRegKey(AUTHKEY_HASH_REG)
	if err != nil {
		log.Println("Warning: failed to read auth hash from registry:", err)
	}

	// Hash not found in registry
	if existingHash == nil {
		// Check OEM location and try to read from there
		oemHashBytes, err := os.ReadFile(AUTHKEY_HASH_OEM_LOCATION)
		if err != nil {
			log.Println("Auth hash not found in registry or OEM location.")
		} else {
			oemHash := string(bytes.TrimSpace(oemHashBytes))
			err = setSecureRegKey(AUTHKEY_HASH_REG, oemHash)
			if err != nil {
				log.Println("Failed to initialize auth hash from OEM location:", err)
			} else {
				log.Println("Initialized auth hash from OEM location.")
			}
		}
	}

	// Setup routes
	r := mux.NewRouter()
	r.HandleFunc("/apps", getApps).Methods("GET")
	r.HandleFunc("/health", getHealth).Methods("GET")
	r.HandleFunc("/version", getVersion).Methods("GET")
	r.HandleFunc("/metrics", getMetrics).Methods("GET")
	r.HandleFunc("/rdp/status", getRdpConnectedStatus).Methods("GET")
	r.HandleFunc("/update", applyUpdate).Methods("POST")
	r.HandleFunc("/get-icon", getIcon).Methods("POST")
	r.HandleFunc("/auth/set-hash", setAuthHash).Methods("POST")
	handler := cors.Default().Handler(r)
	server := &http.Server{
		Addr:              ":7148",
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Println("Starting WinBoat Guest Server on :7148...")
	if err := server.ListenAndServe(); err != nil {
		log.Fatal("Server failed: ", err)
	}
}
