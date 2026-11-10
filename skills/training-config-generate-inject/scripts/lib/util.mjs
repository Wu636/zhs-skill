import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function parseArgv(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  const positional = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }

  return { command, flags, positional };
}

export function argString(flags, ...names) {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function argNumber(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function argBool(flags, name, fallback) {
  if (flags[`no-${name}`] === true) return false;
  if (flags[name] === undefined) return fallback;
  if (flags[name] === true) return true;
  return !/^(false|0|no|off)$/i.test(String(flags[name]));
}

export function toAbs(input, base = process.cwd()) {
  return path.isAbsolute(input) ? input : path.resolve(base, input);
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readText(filePath));
  } catch {
    return fallback;
  }
}

export function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function writeJson(filePath, value) {
  return writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function exists(filePath) {
  return fs.existsSync(filePath);
}

export function nowStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function slugify(input, fallback = "run") {
  const cleaned = String(input || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

export function fingerprint(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function parseEnvFile(filePath) {
  if (!exists(filePath)) return {};
  const out = {};
  for (const line of readText(filePath).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function log(message) {
  process.stdout.write(`${message}\n`);
}

export function warn(message) {
  process.stderr.write(`[warn] ${message}\n`);
}

export function ok(message) {
  process.stdout.write(`[ok] ${message}\n`);
}

export function fail(message) {
  process.stderr.write(`[error] ${message}\n`);
}

export function shortList(items, limit = 8) {
  const list = items.slice(0, limit);
  const suffix = items.length > limit ? ` 等 ${items.length} 项` : "";
  return `${list.join("、")}${suffix}`;
}

export function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function decodeJwtPayload(token) {
  const cleaned = String(token || "").replace(/^Bearer\s+/i, "").trim();
  const parts = cleaned.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function formatDate(timestamp) {
  if (!timestamp) return "unknown";
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
