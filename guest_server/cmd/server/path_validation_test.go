package main

import "testing"

func TestPathHasUNCOrControlChars(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "local path", path: `C:\Windows\System32\notepad.exe`, want: false},
		{name: "environment variable", path: `%WINDIR%\System32\notepad.exe`, want: false},
		{name: "UNC path", path: `\\server\share\icon.exe`, want: true},
		{name: "slash UNC path", path: `//server/share/icon.exe`, want: true},
		{name: "mixed UNC path", path: `\/server\share\icon.exe`, want: true},
		{name: "mixed slash UNC path", path: `/\server\share\icon.exe`, want: true},
		{name: "device path", path: `\\?\C:\icon.exe`, want: true},
		{name: "control character", path: "C:\\icon\n.exe", want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := pathHasUNCOrControlChars(test.path); got != test.want {
				t.Fatalf("pathHasUNCOrControlChars(%q) = %v, want %v", test.path, got, test.want)
			}
		})
	}
}
