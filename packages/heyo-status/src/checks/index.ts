import type {
  CheckResult,
  CompositeMonitorConfig,
  DnsMonitorConfig,
  HttpCheckResult,
  HttpMonitorConfig,
  JsonObject,
  JsonValue,
  SslCheckResult,
  SslMonitorConfig,
  StatusMonitorConfig,
  TcpMonitorConfig,
} from "../types";

const dayMs = 24 * 60 * 60 * 1000;

/**
 * Runs one configured monitor and always returns a persisted-safe result.
 * Composite monitors do not perform I/O; they aggregate `components`, which
 * {@link runStatusChecks} supplies from the same batch.
 */
export async function runStatusCheck(
  monitor: StatusMonitorConfig,
  checkedAt = new Date(),
  components: readonly CheckResult[] = [],
): Promise<CheckResult> {
  switch (monitor.type) {
    case "http":
      return checkHttpMonitor(monitor, checkedAt);
    case "ssl":
      return checkSslMonitor(monitor, checkedAt);
    case "tcp":
      return checkTcpMonitor(monitor, checkedAt);
    case "dns":
      return checkDnsMonitor(monitor, checkedAt);
    case "composite":
      return evaluateCompositeMonitor(monitor, components, checkedAt);
  }
}

/**
 * Runs every monitor which performs I/O concurrently, then derives composite
 * results from that batch. The caller is responsible for persistence.
 */
export async function runStatusChecks(
  monitors: readonly StatusMonitorConfig[],
  checkedAt = new Date(),
): Promise<CheckResult[]> {
  const composites = monitors.filter(
    (monitor): monitor is CompositeMonitorConfig =>
      monitor.type === "composite",
  );
  const checked = await Promise.all(
    monitors
      .filter((monitor) => monitor.type !== "composite")
      .map((monitor) => runStatusCheck(monitor, new Date(checkedAt))),
  );
  const derived = composites.map((monitor) =>
    evaluateCompositeMonitor(monitor, checked, new Date(checkedAt)),
  );

  // Preserve configuration order so CLI output and notifications stay stable.
  const byName = new Map(
    [...checked, ...derived].map((result) => [result.name, result]),
  );
  return monitors.flatMap((monitor) => {
    const result = byName.get(monitor.name);
    return result ? [result] : [];
  });
}

/**
 * Derives a composite status from already-collected component results. Missing
 * components are treated as failures so a misconfiguration cannot silently
 * report a healthy aggregate.
 */
export function evaluateCompositeMonitor(
  monitor: CompositeMonitorConfig,
  components: readonly CheckResult[],
  checkedAt = new Date(),
): CheckResult {
  const byName = new Map(
    components.map((component) => [component.name, component]),
  );
  const resolved = monitor.monitors.map((name) => ({
    name,
    result: byName.get(name),
  }));
  const missing = resolved
    .filter((component) => component.result === undefined)
    .map((component) => component.name);
  const healthy = resolved.filter(
    (component) => component.result?.status === true,
  ).length;
  const total = resolved.length;
  const strategy = monitor.strategy ?? "all";
  const status =
    missing.length > 0
      ? false
      : strategy === "any"
        ? healthy > 0
        : strategy === "majority"
          ? healthy * 2 > total
          : healthy === total;
  const latencyMs = Math.max(
    0,
    ...resolved.map((component) => component.result?.latencyMs ?? 0),
  );

  return {
    name: monitor.name,
    type: "composite",
    status,
    message:
      missing.length > 0
        ? `${healthy}/${total} components healthy; no result for ${missing.join(", ")}`
        : `${healthy}/${total} components healthy (strategy: ${strategy})`,
    latencyMs,
    checkedAt,
  };
}

/** Performs an HTTP monitor check, including response validation and soft retry. */
export async function checkHttpMonitor(
  monitor: HttpMonitorConfig,
  checkedAt = new Date(),
): Promise<HttpCheckResult> {
  const startedAt = performance.now();

  try {
    const firstAttempt = await checkHttpOnce(monitor);
    if (firstAttempt.status || !monitor.softFail) {
      return finishHttp(monitor, checkedAt, startedAt, firstAttempt);
    }

    const softFailMs = monitor.softFailMs ?? 500;
    await wait(softFailMs);
    const secondAttempt = await checkHttpOnce(monitor);

    if (secondAttempt.status) {
      return finishHttp(monitor, checkedAt, startedAt, {
        ...secondAttempt,
        message: `${secondAttempt.message}; recovered on soft retry`,
      });
    }

    return finishHttp(monitor, checkedAt, startedAt, {
      ...secondAttempt,
      status: false,
      message: `${firstAttempt.message}; retried after ${softFailMs}ms and failed again: ${secondAttempt.message}`,
    });
  } catch (error) {
    return finishHttp(monitor, checkedAt, startedAt, {
      status: false,
      message: errorMessage(error),
    });
  }
}

/**
 * Resolve native Node modules without import(): Vite warns about dynamic
 * specifiers, while Next can rewrite them to browser shims even for SSR.
 * Bun 1.4.3+ and supported Node releases expose process.getBuiltinModule;
 * Workers do not load TCP/TLS modules and receive the explicit fallback.
 */
function loadNodeBuiltin<T>(name: string): T | undefined {
  try {
    return globalThis.process?.getBuiltinModule?.(name) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Opens a TLS connection and validates the peer certificate's remaining lifetime. */
export async function checkSslMonitor(
  monitor: SslMonitorConfig,
  checkedAt = new Date(),
): Promise<SslCheckResult> {
  const startedAt = performance.now();
  const timeoutMs = monitor.timeoutMs ?? 10_000;
  const port = monitor.port ?? 443;
  const warnBeforeDays = monitor.warnBeforeDays ?? 14;

  const tls = loadNodeBuiltin<typeof import("node:tls")>("node:tls");
  if (typeof tls?.connect !== "function") {
    return {
      ...finish(
        monitor,
        checkedAt,
        startedAt,
        false,
        "TLS monitoring is unavailable in this runtime.",
      ),
      type: "ssl",
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof tls.connect> | undefined;

    const finishOnce = (
      status: boolean,
      message: string,
      certificate: { expiresInDays?: number; expiring?: boolean } = {},
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket?.destroy();
      resolve({
        ...finish(monitor, checkedAt, startedAt, status, message),
        type: "ssl",
        ...certificate,
      });
    };

    const timeout = setTimeout(() => {
      finishOnce(false, `TLS timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    try {
      socket = tls.connect({
        host: monitor.host,
        port,
        servername: monitor.host,
        // This lets us report the certificate state consistently on secureConnect;
        // authorization is still required below.
        rejectUnauthorized: false,
      });

      socket.once("secureConnect", () => {
        const certificate = socket?.getPeerCertificate();
        const validTo = certificate?.valid_to
          ? new Date(certificate.valid_to)
          : undefined;
        const expiresInDays = validTo
          ? Math.floor((validTo.getTime() - checkedAt.getTime()) / dayMs)
          : Number.NaN;

        if (!socket?.authorized) {
          finishOnce(
            false,
            `TLS unauthorized: ${String(socket?.authorizationError ?? "unknown error")}`,
          );
          return;
        }

        if (!validTo || Number.isNaN(expiresInDays)) {
          finishOnce(false, "TLS certificate expiry date is unavailable");
          return;
        }

        if (expiresInDays < warnBeforeDays) {
          finishOnce(
            false,
            `TLS certificate expires in ${expiresInDays} days, threshold is ${warnBeforeDays}`,
            { expiresInDays, expiring: true },
          );
          return;
        }

        finishOnce(true, `TLS certificate expires in ${expiresInDays} days`, {
          expiresInDays,
        });
      });

      socket.once("error", (error) => finishOnce(false, errorMessage(error)));
    } catch (error) {
      finishOnce(false, errorMessage(error));
    }
  });
}

/** Opens a TCP socket and considers a successful connection healthy. */
export async function checkTcpMonitor(
  monitor: TcpMonitorConfig,
  checkedAt = new Date(),
): Promise<CheckResult> {
  const startedAt = performance.now();
  const timeoutMs = monitor.timeoutMs ?? 10_000;

  const net = loadNodeBuiltin<typeof import("node:net")>("node:net");
  if (typeof net?.Socket !== "function") {
    return finish(
      monitor,
      checkedAt,
      startedAt,
      false,
      "TCP monitoring is unavailable in this runtime.",
    );
  }

  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finishOnce = (status: boolean, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(finish(monitor, checkedAt, startedAt, status, message));
    };

    const timeout = setTimeout(() => {
      finishOnce(false, `TCP timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    socket.once("connect", () => finishOnce(true, "TCP connection opened"));
    socket.once("error", (error) => finishOnce(false, errorMessage(error)));

    try {
      socket.connect(monitor.port, monitor.host);
    } catch (error) {
      finishOnce(false, errorMessage(error));
    }
  });
}

/** Resolves a DNS record through Cloudflare DNS-over-HTTPS. */
export async function checkDnsMonitor(
  monitor: DnsMonitorConfig,
  checkedAt = new Date(),
): Promise<CheckResult> {
  const startedAt = performance.now();
  const timeoutMs = monitor.timeoutMs ?? 10_000;
  const recordType = monitor.recordType ?? "A";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", monitor.host);
    url.searchParams.set("type", recordType);

    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return finish(
        monitor,
        checkedAt,
        startedAt,
        false,
        `DNS query returned HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      Status?: number;
      Answer?: unknown[];
    };

    if (payload.Status !== 0) {
      return finish(
        monitor,
        checkedAt,
        startedAt,
        false,
        `DNS response status ${String(payload.Status)}`,
      );
    }

    const answerCount = Array.isArray(payload.Answer)
      ? payload.Answer.length
      : 0;
    return finish(
      monitor,
      checkedAt,
      startedAt,
      answerCount > 0,
      answerCount > 0
        ? `DNS ${recordType} returned ${answerCount} answer(s)`
        : `DNS ${recordType} returned no answers`,
    );
  } catch (error) {
    return finish(monitor, checkedAt, startedAt, false, errorMessage(error));
  } finally {
    clearTimeout(timeout);
  }
}

type HttpAttempt = Omit<HttpCheckResult, keyof CheckResult> & {
  status: boolean;
  message: string;
};

async function checkHttpOnce(monitor: HttpMonitorConfig): Promise<HttpAttempt> {
  const timeoutMs = monitor.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method ?? "GET",
      headers: monitor.headers,
      signal: controller.signal,
      redirect: monitor.followRedirects === false ? "manual" : "follow",
    });
    const expectedStatus = monitor.expectedStatus ?? [200];
    const statusOk = expectedStatus.includes(response.status);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const responseHeaderMessages: string[] = [];
    let headersOk = true;

    for (const [name, expectedValue] of Object.entries(
      monitor.expectedResponseHeaders ?? {},
    )) {
      const actualValue = response.headers.get(name);
      if (actualValue !== expectedValue) {
        headersOk = false;
        responseHeaderMessages.push(
          `response header ${name} is ${actualValue === null ? "missing" : JSON.stringify(actualValue)}, expected ${JSON.stringify(expectedValue)}`,
        );
      }
    }

    const needsBody =
      monitor.expectedBodyIncludes !== undefined ||
      monitor.expectedBodyExcludes !== undefined ||
      monitor.expectedJson !== undefined;
    let bodyMatch: boolean | undefined;
    let jsonMatch: boolean | undefined;
    const bodyMessages: string[] = [];

    if (needsBody) {
      const body = await response.text();
      bodyMatch = true;

      if (
        monitor.expectedBodyIncludes !== undefined &&
        !body.includes(monitor.expectedBodyIncludes)
      ) {
        bodyMatch = false;
        bodyMessages.push(
          `body does not include ${JSON.stringify(monitor.expectedBodyIncludes)}`,
        );
      }

      if (
        monitor.expectedBodyExcludes !== undefined &&
        body.includes(monitor.expectedBodyExcludes)
      ) {
        bodyMatch = false;
        bodyMessages.push(
          `body includes excluded text ${JSON.stringify(monitor.expectedBodyExcludes)}`,
        );
      }

      if (monitor.expectedJson !== undefined) {
        try {
          jsonMatch = matchesExpectedJson(
            JSON.parse(body) as JsonValue,
            monitor.expectedJson,
          );
          if (!jsonMatch)
            bodyMessages.push("JSON body does not match expectedJson");
        } catch {
          jsonMatch = false;
          bodyMessages.push("body is not valid JSON");
        }
      }
    }

    const status =
      statusOk && headersOk && bodyMatch !== false && jsonMatch !== false;
    return {
      status,
      message: status
        ? `HTTP ${response.status}`
        : [
            statusOk
              ? undefined
              : `HTTP ${response.status}, expected ${expectedStatus.join(", ")}`,
            ...responseHeaderMessages,
            ...bodyMessages,
          ]
            .filter((message): message is string => message !== undefined)
            .join("; "),
      httpStatus: response.status,
      responseHeaders,
      ...(bodyMatch === undefined ? {} : { bodyMatch }),
      ...(jsonMatch === undefined ? {} : { jsonMatch }),
    };
  } catch (error) {
    return {
      status: false,
      message:
        error instanceof Error && error.name === "AbortError"
          ? `HTTP timed out after ${timeoutMs}ms`
          : errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function finish(
  monitor: StatusMonitorConfig,
  checkedAt: Date,
  startedAt: number,
  status: boolean,
  message: string,
): CheckResult {
  return {
    name: monitor.name,
    type: monitor.type,
    status,
    message,
    latencyMs: elapsedMs(startedAt),
    checkedAt,
  };
}

function finishHttp(
  monitor: HttpMonitorConfig,
  checkedAt: Date,
  startedAt: number,
  attempt: HttpAttempt,
): HttpCheckResult {
  return {
    name: monitor.name,
    type: "http",
    status: attempt.status,
    message: attempt.message,
    latencyMs: elapsedMs(startedAt),
    checkedAt,
    ...(attempt.httpStatus === undefined
      ? {}
      : { httpStatus: attempt.httpStatus }),
    ...(attempt.responseHeaders === undefined
      ? {}
      : { responseHeaders: attempt.responseHeaders }),
    ...(attempt.bodyMatch === undefined
      ? {}
      : { bodyMatch: attempt.bodyMatch }),
    ...(attempt.jsonMatch === undefined
      ? {}
      : { jsonMatch: attempt.jsonMatch }),
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function matchesExpectedJson(actual: JsonValue, expected: JsonObject): boolean {
  if (!isJsonObject(actual)) return false;

  return Object.entries(expected).every(([key, expectedValue]) => {
    if (!(key in actual)) return false;
    return jsonValueMatches(actual[key], expectedValue);
  });
}

function jsonValueMatches(actual: JsonValue, expected: JsonValue): boolean {
  if (isJsonObject(expected)) {
    return (
      isJsonObject(actual) &&
      Object.entries(expected).every(([key, expectedValue]) =>
        key in actual ? jsonValueMatches(actual[key], expectedValue) : false,
      )
    );
  }

  if (Array.isArray(expected))
    return JSON.stringify(actual) === JSON.stringify(expected);
  return Object.is(actual, expected);
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
