import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";
import tls from "node:tls";

import {
  checkDnsMonitor,
  checkHttpMonitor,
  checkSslMonitor,
  checkTcpMonitor,
  evaluateCompositeMonitor,
  runStatusChecks,
} from "../src/checks";
import type { CheckResult, CompositeMonitorConfig } from "../src/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HTTP checker", () => {
  test("validates status, response headers, body, and JSON while recording diagnostics", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ status: "ok", meta: { version: 1 } }),
          {
            headers: {
              "content-type": "application/json",
              "x-health": "ready",
            },
          },
        );
      },
    });

    try {
      const result = await checkHttpMonitor({
        name: "API",
        type: "http",
        url: `http://localhost:${server.port}/health`,
        expectedStatus: [200],
        expectedResponseHeaders: { "x-health": "ready" },
        expectedBodyIncludes: '"status":"ok"',
        expectedBodyExcludes: "failure",
        expectedJson: { status: "ok", meta: { version: 1 } },
      });

      expect(result).toMatchObject({
        name: "API",
        type: "http",
        status: true,
        httpStatus: 200,
        bodyMatch: true,
        jsonMatch: true,
        responseHeaders: { "x-health": "ready" },
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      server.stop(true);
    }
  });

  test("retries a failed HTTP monitor once when softFail is enabled", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        attempts += 1;
        return new Response(
          attempts === 1 ? "temporarily unavailable" : "healthy",
          {
            status: attempts === 1 ? 503 : 200,
          },
        );
      },
    });

    try {
      const result = await checkHttpMonitor({
        name: "Website",
        type: "http",
        url: `http://localhost:${server.port}`,
        expectedStatus: [200],
        softFail: true,
        softFailMs: 1,
      });

      expect(attempts).toBe(2);
      expect(result.status).toBe(true);
      expect(result.message).toContain("recovered on soft retry");
    } finally {
      server.stop(true);
    }
  });

  test("reports a response-header mismatch as down", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok", { headers: { "x-health": "stale" } });
      },
    });

    try {
      const result = await checkHttpMonitor({
        name: "API",
        type: "http",
        url: `http://localhost:${server.port}`,
        expectedResponseHeaders: { "x-health": "ready" },
      });

      expect(result.status).toBe(false);
      expect(result.message).toContain("response header x-health");
    } finally {
      server.stop(true);
    }
  });
});

describe("TCP and SSL checkers", () => {
  test("marks a connectable TCP endpoint as up", async () => {
    const server = net.createServer((socket) => socket.end());
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP address");

    try {
      const result = await checkTcpMonitor({
        name: "TCP",
        type: "tcp",
        host: "127.0.0.1",
        port: address.port,
        timeoutMs: 1_000,
      });

      expect(result).toMatchObject({
        status: true,
        message: "TCP connection opened",
      });
    } finally {
      await close(server);
    }
  });

  test("returns a persisted-safe failure for an untrusted TLS certificate", async () => {
    const [key, cert] = await Promise.all([
      Bun.file(new URL("./fixtures/localhost-key.pem", import.meta.url)).text(),
      Bun.file(
        new URL("./fixtures/localhost-cert.pem", import.meta.url),
      ).text(),
    ]);
    const server = tls.createServer({ key, cert }, (socket) => socket.end());
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TLS address");

    try {
      const result = await checkSslMonitor({
        name: "TLS",
        type: "ssl",
        host: "localhost",
        port: address.port,
        timeoutMs: 1_000,
      });

      expect(result.type).toBe("ssl");
      expect(result.status).toBe(false);
      expect(result.message).toContain("TLS unauthorized");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      // An untrusted certificate is an outage, not an expiry warning.
      expect(result.expiring).toBeUndefined();
    } finally {
      await close(server);
    }
  });
});

describe("DNS checker", () => {
  test("uses DNS-over-HTTPS and requires at least one answer", async () => {
    let requestedUrl: URL | undefined;
    globalThis.fetch = (async (input) => {
      requestedUrl = new URL(input.toString());
      return Response.json({ Status: 0, Answer: [{ data: "192.0.2.1" }] });
    }) as typeof fetch;

    const [result] = await runStatusChecks([
      {
        name: "DNS",
        type: "dns",
        host: "example.com",
        recordType: "A",
        timeoutMs: 1_000,
      },
    ]);

    expect(result).toMatchObject({
      status: true,
      message: "DNS A returned 1 answer(s)",
    });
    expect(requestedUrl?.origin).toBe("https://cloudflare-dns.com");
    expect(requestedUrl?.searchParams.get("name")).toBe("example.com");
    expect(requestedUrl?.searchParams.get("type")).toBe("A");
  });

  test("reports a DNS response without answers as down", async () => {
    globalThis.fetch = (async () =>
      Response.json({ Status: 0, Answer: [] })) as unknown as typeof fetch;

    const result = await checkDnsMonitor({
      name: "DNS",
      type: "dns",
      host: "example.com",
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({
      status: false,
      message: "DNS A returned no answers",
    });
  });
});

describe("composite checker", () => {
  const components: CheckResult[] = [
    componentResult("Website", true, 30),
    componentResult("API", false, 120),
    componentResult("Database", true, 8),
  ];

  test("aggregates component results per strategy", () => {
    expect(evaluate("all", components)).toMatchObject({
      type: "composite",
      status: false,
      message: "2/3 components healthy (strategy: all)",
      latencyMs: 120,
    });
    expect(evaluate("any", components).status).toBe(true);
    expect(evaluate("majority", components).status).toBe(true);
    expect(
      evaluate("majority", [
        componentResult("Website", true, 10),
        componentResult("API", false, 10),
        componentResult("Database", false, 10),
      ]).status,
    ).toBe(false);
  });

  test("treats a missing component result as a failure", () => {
    const result = evaluate("any", [componentResult("Website", true, 10)]);

    expect(result.status).toBe(false);
    expect(result.message).toContain("no result for API, Database");
  });

  test("derives composites from the same batch and keeps configuration order", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });

    try {
      const results = await runStatusChecks([
        {
          name: "Stack",
          type: "composite",
          monitors: ["Website"],
          strategy: "all",
        },
        {
          name: "Website",
          type: "http",
          url: `http://localhost:${server.port}/`,
        },
      ]);

      expect(results.map((result) => result.name)).toEqual([
        "Stack",
        "Website",
      ]);
      expect(results[0]).toMatchObject({ type: "composite", status: true });
    } finally {
      server.stop(true);
    }
  });
});

function evaluate(
  strategy: CompositeMonitorConfig["strategy"],
  components: CheckResult[],
): CheckResult {
  return evaluateCompositeMonitor(
    {
      name: "Full Stack Health",
      type: "composite",
      monitors: ["Website", "API", "Database"],
      strategy,
    },
    components,
    new Date("2026-01-15T12:00:00.000Z"),
  );
}

function componentResult(
  name: string,
  status: boolean,
  latencyMs: number,
): CheckResult {
  return {
    name,
    type: "http",
    status,
    message: status ? "HTTP 200" : "HTTP 503",
    latencyMs,
    checkedAt: new Date("2026-01-15T12:00:00.000Z"),
  };
}

function listen(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
