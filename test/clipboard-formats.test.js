const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizedText,
  stripHtml,
  asPreview,
  collectFilePathsFromBuffers,
  buildFileSnapshot,
  buildFileClipboardPayload
} = require("../src/clipboard-formats");

test("normalizedText converts CRLF to LF", () => {
  assert.equal(normalizedText("a\r\nb\r\n"), "a\nb\n");
});

test("stripHtml removes tags and script/style blocks", () => {
  const html = "<style>.x{}</style><script>bad()</script><p>Hello <b>World</b></p>";
  assert.equal(stripHtml(html), "Hello World");
});

test("asPreview trims whitespace and caps length", () => {
  const long = `  ${"a".repeat(300)}  `;
  const preview = asPreview(long);
  assert.equal(preview.length, 240);
  assert.equal(preview, "a".repeat(240));
});

test("collectFilePathsFromBuffers extracts and dedupes file urls and absolute paths", () => {
  const formats = ["public.file-url", "text/plain"];
  const readBuffer = (format) => {
    if (format !== "public.file-url") {
      return Buffer.from("");
    }
    return Buffer.from(
      "file:///Users/test/Documents/Report.txt\n/Users/test/Documents/Report.txt\nfile:///Users/test/Pictures/image.png",
      "utf8"
    );
  };

  const paths = collectFilePathsFromBuffers(formats, readBuffer, {
    existsSync: () => true,
    resolvePath: (p) => p,
    maxItems: 64
  });

  assert.deepEqual(paths, [
    "/Users/test/Documents/Report.txt",
    "/Users/test/Pictures/image.png"
  ]);
});

test("collectFilePathsFromBuffers supports NSFilenamesPboardType plist", () => {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><array>',
    "<string>/Users/test/a.txt</string>",
    "<string>/Users/test/folder</string>",
    "</array></plist>"
  ].join("");

  const paths = collectFilePathsFromBuffers(
    ["NSFilenamesPboardType"],
    () => Buffer.from(plist, "utf8"),
    { existsSync: () => true, resolvePath: (p) => p, maxItems: 64 }
  );

  assert.deepEqual(paths, ["/Users/test/a.txt", "/Users/test/folder"]);
});

test("collectFilePathsFromBuffers ignores non-file formats", () => {
  const paths = collectFilePathsFromBuffers(["text/plain"], () => Buffer.from("/Users/test/a", "utf8"), {
    existsSync: () => true,
    resolvePath: (p) => p
  });
  assert.deepEqual(paths, []);
});

test("buildFileSnapshot returns null for empty paths", () => {
  assert.equal(buildFileSnapshot([], () => "x"), null);
});

test("buildFileSnapshot returns files snapshot with preview and signature", () => {
  const snapshot = buildFileSnapshot(["/Users/test/a.txt", "/Users/test/folder"], (value) => `hash:${value.length}`);
  assert.equal(snapshot.kind, "files");
  assert.equal(snapshot.preview, "a.txt +1 more");
  assert.equal(snapshot.signature, "files:hash:36");
  assert.deepEqual(snapshot.payload.paths, ["/Users/test/a.txt", "/Users/test/folder"]);
});

test("buildFileClipboardPayload emits text/uri-list/public-file-url/plist values", () => {
  const payload = buildFileClipboardPayload(["/Users/test/My File.txt", "/Users/test/folder"]);
  assert.equal(payload.text, "/Users/test/My File.txt\n/Users/test/folder");
  assert.match(payload.uriList, /^file:\/\/\/Users\/test\/My%20File\.txt\nfile:\/\/\/Users\/test\/folder$/);
  assert.match(payload.publicFileUrl, /^file:\/\/\/Users\/test\/My%20File\.txt\u0000$/);
  assert.match(payload.nsFilenamesPboardType, /<string>\/Users\/test\/My File\.txt<\/string>/);
  assert.match(payload.nsFilenamesPboardType, /<string>\/Users\/test\/folder<\/string>/);
});
