import { createConsola } from "consola";
const { writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync }: typeof import("fs") = require("node:fs");
const { dirname }: typeof import("path") = require("node:path");

export function createLogger(filePath: string) {
    const logger = createConsola({
        level: 4,
        formatOptions: {
            colors: true,
            date: true,
            compact: false,
        },
    });

    // Add file logging with directory creation
    logger.addReporter({
        log: logObj => {
            const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
            const level = logObj.type.toUpperCase();
            const message = logObj.args.join(" ");
            const logLine = `${timestamp} | ${level} | ${message}\n`;

            try {
                appendFileSync(filePath, logLine);
            } catch {
                // Create the directory path if it doesn't exist
                const dir = dirname(filePath);
                mkdirSync(dir, { recursive: true });

                // Now create the file
                writeFileSync(filePath, logLine);
            }
        },
    });

    return logger;
}

export function readLogTail(file: string): string {
    if (!existsSync(file)) return "No logs yet.";
    const size = statSync(file).size;
    const buffer = Buffer.alloc(Math.min(size, 256 * 1024));
    const fd = openSync(file, "r");
    try {
        readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        return buffer.toString("utf8");
    } finally { closeSync(fd); }
}
