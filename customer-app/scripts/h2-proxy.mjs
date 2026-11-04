// Local HTTP/2 + TLS front for `next start`, so Lighthouse measures the app the
// way a CDN serves it (HTTP/2 multiplexing) instead of local HTTP/1.1.
// Usage: node scripts/h2-proxy.mjs <listenPort> <upstreamPort>
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";

const [listen = "3443", upstream = "3400"] = process.argv.slice(2);
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "http2-settings", "host"]);

const server = http2.createSecureServer({
  key: fs.readFileSync(".lighthouseci/certs/key.pem"),
  cert: fs.readFileSync(".lighthouseci/certs/cert.pem"),
  allowHTTP1: true,
});

server.on("request", (req, res) => {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!k.startsWith(":") && !HOP.has(k)) headers[k] = v;
  headers.host = `localhost:${upstream}`;
  const up = http.request({ host: "127.0.0.1", port: upstream, method: req.method, path: req.url, headers }, (r) => {
    const out = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});

server.listen(Number(listen), () => console.log(`h2 proxy ready on https://localhost:${listen} -> :${upstream}`));
