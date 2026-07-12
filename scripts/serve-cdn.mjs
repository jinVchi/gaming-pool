import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Dev stand-in for the `cdn.` R2 bucket: serves unity/{slug}/Build/* over HTTP
// with the same Content-Type/Content-Encoding conventions production uses.
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "unity");
const PORT = Number(process.env.PORT ?? 8787);

const CONTENT_TYPES = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".data": "application/octet-stream",
  ".html": "text/html",
  ".symbols.json": "application/json",
};

function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const requestedPath = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname));
  if (requestedPath.includes("..")) {
    res.writeHead(400).end("bad path");
    return;
  }

  const filePath = join(ROOT, requestedPath);
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(400).end("bad path");
    return;
  }

  const brPath = `${filePath}.br`;
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    createReadStream(filePath).pipe(res);
    return;
  }
  if (existsSync(brPath)) {
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Content-Encoding": "br",
    });
    createReadStream(brPath).pipe(res);
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`cdn-dev serving ${ROOT} on http://localhost:${PORT}`);
});
