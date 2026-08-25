package main

import "testing"

func TestIsSafeIconPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "local path", path: `C:\Windows\System32\notepad.exe`, want: true},
		{name: "environment variable", path: `%WINDIR%\System32\notepad.exe`, want: true},
		{name: "UNC path", path: `\\server\share\icon.exe`, want: false},
		{name: "slash UNC path", path: `//server/share/icon.exe`, want: false},
		{name: "control character", path: "C:\\icon\n.exe", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSafeIconPath(test.path); got != test.want {
				t.Fatalf("isSafeIconPath(%q) = %v, want %v", test.path, got, test.want)
			}
		})
	}
}
