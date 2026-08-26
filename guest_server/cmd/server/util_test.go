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
