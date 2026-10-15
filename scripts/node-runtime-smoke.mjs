import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";

import {
  checkSslMonitor,
  checkTcpMonitor,
} from "../packages/heyo-status/dist/checks.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "localhost", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return address.port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

// A Bun unit test cannot catch a missing Node builtin or a browser shim in a
// published Node build. Run these checks with the supported Node versions.
const tcp = net.createServer((socket) => socket.end());
try {
  const port = await listen(tcp);
  const result = await checkTcpMonitor({
    name: "Local TCP",
    type: "tcp",
    host: "localhost",
    port,
    timeoutMs: 1_000,
  });
  assert.equal(result.status, true, result.message);
  console.log(`Node ${process.version}: TCP socket opened`);
} finally {
  await close(tcp);
}

const [key, cert] = await Promise.all([
  readFile(
    new URL(
      "../packages/heyo-status/test/fixtures/localhost-key.pem",
      import.meta.url,
    ),
  ),
  readFile(
    new URL(
      "../packages/heyo-status/test/fixtures/localhost-cert.pem",
      import.meta.url,
    ),
  ),
]);
const ssl = tls.createServer({ key, cert }, (socket) => socket.end());
try {
  const port = await listen(ssl);
  const result = await checkSslMonitor({
    name: "Local SSL",
    type: "ssl",
    host: "localhost",
    port,
    timeoutMs: 1_000,
  });
  assert.equal(result.status, false);
  assert.match(result.message, /TLS unauthorized/);
  console.log(`Node ${process.version}: TLS certificate inspected`);
} finally {
  await close(ssl);
}
