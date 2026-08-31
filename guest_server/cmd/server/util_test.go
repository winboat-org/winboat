//go:build windows

package main

import "testing"

func TestPowerShellParameterNamesAreStrictlyAllowlisted(t *testing.T) {
	for _, value := range []string{"-PathPrefix", "-Limit"} {
		if !isPowerShellParameterName(value) {
			t.Fatalf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"PathPrefix", "-Path Prefix", "-Path;whoami", "--", "-경로"} {
		if isPowerShellParameterName(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestPowerShellValuesEscapeSingleQuotes(t *testing.T) {
	if got, want := quotePowerShellArgument(`C:\Apps\O'Brien`), `'C:\Apps\O''Brien'`; got != want {
		t.Fatalf("quotePowerShellArgument() = %q, want %q", got, want)
	}
}

func TestBoundedOutputRetainsOnlyTheLimit(t *testing.T) {
	output := boundedOutput{limit: 5}
	if count, err := output.Write([]byte("abc")); err != nil || count != 3 {
		t.Fatalf("first Write() = %d, %v", count, err)
	}
	if count, err := output.Write([]byte("defg")); err != nil || count != 4 {
		t.Fatalf("second Write() = %d, %v", count, err)
	}
	if got, want := output.String(), "abcde"; got != want {
		t.Fatalf("bounded output = %q, want %q", got, want)
	}
	if !output.exceeded {
		t.Fatal("bounded output did not record overflow")
	}
}
