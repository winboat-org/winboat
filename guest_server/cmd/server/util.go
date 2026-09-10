//go:build windows

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

var errPowerShellOutputLimit = errors.New("PowerShell output exceeds the safe size limit")

func executePowerShellScript(script string, utf8Out bool, args ...string) ([]byte, error) {
	return executePowerShellScriptContext(context.Background(), script, utf8Out, args...)
}

func executePowerShellScriptContext(ctx context.Context, script string, utf8Out bool, args ...string) ([]byte, error) {
	return executePowerShellScriptContextBounded(ctx, script, utf8Out, 0, args...)
}

func executePowerShellScriptContextBounded(ctx context.Context, script string, utf8Out bool, maxOutputBytes int, args ...string) ([]byte, error) {
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

	return commandOutputBounded(ctx, powerShellArgs, maxOutputBytes)
}

func executePowerShellScriptWithNamedArgsContext(ctx context.Context, script string, args ...string) ([]byte, error) {
	return executePowerShellScriptWithNamedArgsContextBounded(ctx, script, 0, args...)
}

func executePowerShellScriptWithNamedArgsContextBounded(ctx context.Context, script string, maxOutputBytes int, args ...string) ([]byte, error) {
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
	return commandOutputBounded(ctx, []string{"-ExecutionPolicy", "Bypass", "-Command", command}, maxOutputBytes)
}

func commandOutputBounded(ctx context.Context, powerShellArgs []string, maxOutputBytes int) ([]byte, error) {
	if maxOutputBytes <= 0 {
		return exec.CommandContext(ctx, "powershell", powerShellArgs...).Output()
	}
	output := boundedOutput{limit: maxOutputBytes}
	command := exec.CommandContext(ctx, "powershell", powerShellArgs...)
	command.Stdout = &output
	if err := command.Run(); err != nil {
		return nil, err
	}
	if output.exceeded {
		return nil, errPowerShellOutputLimit
	}
	return output.Bytes(), nil
}

type boundedOutput struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func (output *boundedOutput) Write(data []byte) (int, error) {
	available := output.limit - output.Len()
	if available > 0 {
		count := min(available, len(data))
		_, _ = output.Buffer.Write(data[:count])
	}
	if len(data) > available {
		output.exceeded = true
	}
	return len(data), nil
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
