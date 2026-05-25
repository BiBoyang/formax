import type { FileReference } from "../types";

const externalProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);
const lineSuffixPattern = /^(.*?)(?::(\d+)(?:-(\d+))?)$/;
const obviousFileExtensions = new Set([
  "c",
  "cc",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "markdown",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const commonWebTlds = new Set([
  "ai",
  "app",
  "biz",
  "cc",
  "cloud",
  "cn",
  "co",
  "com",
  "dev",
  "fm",
  "gg",
  "info",
  "io",
  "me",
  "net",
  "org",
  "sh",
  "site",
  "so",
  "tech",
  "tv",
  "xyz",
]);

export function isExternalHref(href: string): boolean {
  try {
    return externalProtocols.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function parseFileReference(href: string, label?: string): FileReference | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || isExternalHref(trimmed) || hasProtocol(trimmed)) {
    return null;
  }

  const match = lineSuffixPattern.exec(trimmed);
  if (match?.[1]) {
    if (!isPathLikeReference(match[1])) {
      return null;
    }
    return {
      path: match[1],
      label,
      line: toPositiveInteger(match[2]),
      endLine: toPositiveInteger(match[3]),
    };
  }

  if (!isPathLikeReference(trimmed)) {
    return null;
  }

  return { path: trimmed, label };
}

function isPathLikeReference(value: string): boolean {
  const path = value.trim();
  if (!path) {
    return false;
  }

  if (looksLikeHostReference(path)) {
    return false;
  }

  if (/^(?:\/|~\/|\.{1,2}\/)/.test(path) || path.includes("/")) {
    return true;
  }

  const basename = path.split(/[\\/]/).pop() ?? path;
  const extensionMatch = /\.([A-Za-z0-9][A-Za-z0-9_-]{0,15})$/.exec(basename);
  if (extensionMatch != null) {
    const extension = extensionMatch[1]?.toLowerCase();
    if (extension != null && obviousFileExtensions.has(extension)) {
      return true;
    }
  }

  if (!/[.@]/.test(path) && /^[A-Za-z0-9_-]+$/.test(path)) {
    return true;
  }

  return false;
}

function hasProtocol(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) && !lineSuffixPattern.test(value);
}

function toPositiveInteger(value: string | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function looksLikeHostReference(value: string): boolean {
  const match = /^(?:[A-Za-z0-9-]+\.)+([A-Za-z]{2,24})(?:[/?#].*)?$/.exec(value);
  if (match == null) {
    return false;
  }
  const tld = match[1]?.toLowerCase();
  return tld != null && commonWebTlds.has(tld);
}
