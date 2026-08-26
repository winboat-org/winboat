//go:build windows

package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

func executePowerShellScript(script string, utf8Out bool, args ...string) ([]byte, error) {
	return executePowerShellScriptContext(context.Background(), script, utf8Out, args...)
}

func executePowerShellScriptContext(ctx context.Context, script string, utf8Out bool, args ...string) ([]byte, error) {
	powerShellArgs := []string{"-ExecutionPolicy", "Bypass"}
	if utf8Out {
		command := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & " + quotePowerShellArgument(script)
		for _, arg := range args {
			command += " " + quotePowerShellArgument(arg)
		}
		powerShellArgs = append(powerShellArgs, "-Command", command)
	} else {
		powerShellArgs = append(powerShellArgs, "-File", script)
		powerShellArgs = append(powerShellArgs, args...)
	}

	return commandOutput(ctx, powerShellArgs)
}

func executePowerShellScriptWithNamedArgsContext(ctx context.Context, script string, args ...string) ([]byte, error) {
	if len(args)%2 != 0 {
		return nil, fmt.Errorf("PowerShell named arguments must be pairs")
	}
	command := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & " + quotePowerShellArgument(script)
	for index := 0; index < len(args); index += 2 {
		name := args[index]
		if !isPowerShellParameterName(name) {
			return nil, fmt.Errorf("invalid PowerShell parameter name")
		}
		command += " " + name + " " + quotePowerShellArgument(args[index+1])
	}
	return commandOutput(ctx, []string{"-ExecutionPolicy", "Bypass", "-Command", command})
}

func commandOutput(ctx context.Context, powerShellArgs []string) ([]byte, error) {
	return exec.CommandContext(ctx, "powershell", powerShellArgs...).Output()
}

func isPowerShellParameterName(value string) bool {
	if len(value) < 2 || len(value) > 64 || value[0] != '-' {
		return false
	}
	for _, character := range value[1:] {
		if !((character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z')) {
			return false
		}
	}
	return true
}

func quotePowerShellArgument(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
