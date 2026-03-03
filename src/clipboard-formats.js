const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

function normalizedText(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

function stripHtml(html) {
  return normalizedText(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asPreview(text) {
  const cleaned = normalizedText(text).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.slice(0, 240);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeBufferCandidates(buffer) {
  return [buffer.toString("utf8"), buffer.toString("utf16le")];
}

function extractPathsFromXmlPlist(text) {
  if (!text.includes("<plist")) {
    return [];
  }
  const matches = text.matchAll(/<string>([^<]+)<\/string>/g);
  return [...matches].map((match) => match[1]).filter(Boolean);
}

function extractPathsFromText(text) {
  const raw = normalizedText(text).replaceAll("\0", "\n");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const paths = [];
  const fileUrls = raw.match(/file:\/\/[^\s\r\n\0]+/g) || [];

  for (const urlText of fileUrls) {
    try {
      paths.push(fileURLToPath(urlText));
    } catch {
      continue;
    }
  }

  for (const line of lines) {
    if (line.startsWith("/")) {
      paths.push(line);
      continue;
    }
    if (line.startsWith("file://")) {
      try {
        paths.push(fileURLToPath(line));
      } catch {
        continue;
      }
    }
  }

  return paths;
}

function dedupeExistingPaths(paths, opts = {}) {
  const resolvePath = opts.resolvePath || path.resolve;
  const existsSync = opts.existsSync || fs.existsSync;
  const maxItems = Number.isInteger(opts.maxItems) ? opts.maxItems : 64;

  const unique = [];
  const seen = new Set();
  for (const candidate of paths) {
    const resolved = resolvePath(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    if (!existsSync(resolved)) {
      continue;
    }
    seen.add(resolved);
    unique.push(resolved);
    if (unique.length >= maxItems) {
      break;
    }
  }
  return unique;
}

function collectFilePathsFromBuffers(formats, readBuffer, opts = {}) {
  if (!Array.isArray(formats) || !formats.length) {
    return [];
  }
  const maxItems = Number.isInteger(opts.maxItems) ? opts.maxItems : 64;

  const likelyFileFormats = formats.filter((format) =>
    /file-url|filenames|uri-list/i.test(format)
  );
  if (!likelyFileFormats.length) {
    return [];
  }

  const extracted = [];
  for (const format of likelyFileFormats) {
    try {
      const buffer = readBuffer(format);
      if (!buffer || buffer.byteLength === 0) {
        continue;
      }
      for (const decoded of decodeBufferCandidates(buffer)) {
        extracted.push(...extractPathsFromXmlPlist(decoded));
        extracted.push(...extractPathsFromText(decoded));
      }
    } catch {
      continue;
    }
  }

  return dedupeExistingPaths(extracted, {
    resolvePath: opts.resolvePath,
    existsSync: opts.existsSync,
    maxItems
  });
}

function buildFileSnapshot(paths, hashText) {
  if (!Array.isArray(paths) || !paths.length) {
    return null;
  }

  const firstName = path.basename(paths[0]);
  const preview = paths.length === 1 ? firstName : `${firstName} +${paths.length - 1} more`;
  const searchText = `${paths.join("\n")}\n${paths.map((item) => path.basename(item)).join("\n")}`;
  return {
    kind: "files",
    signature: `files:${hashText(paths.join("\n"))}`,
    preview,
    searchableText: searchText,
    payload: { paths }
  };
}

function buildFileClipboardPayload(paths) {
  const urls = paths.map((item) => pathToFileURL(item).toString());
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<plist version=\"1.0\"><array>",
    ...paths.map((item) => `<string>${escapeXml(item)}</string>`),
    "</array></plist>"
  ].join("");

  return {
    text: paths.join("\n"),
    uriList: urls.join("\n"),
    publicFileUrl: urls[0] ? `${urls[0]}\0` : "",
    nsFilenamesPboardType: plist
  };
}

module.exports = {
  normalizedText,
  stripHtml,
  asPreview,
  collectFilePathsFromBuffers,
  buildFileSnapshot,
  buildFileClipboardPayload
};
