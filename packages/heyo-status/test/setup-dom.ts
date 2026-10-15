/**
 * Test preload: a DOM, registered before anything else is imported.
 *
 * Bun imports every test file before it runs any of them, so a DOM registered
 * at the top of one file still arrives after React and Base UI have been
 * evaluated by another — and both decide once, at module scope, whether they
 * are rendering on a server. Portals then never mount, which silently empties
 * every dialog in the suite. This preload is the only place that runs first for
 * all of them.
 *
 * The network deliberately stays native. happy-dom ships its own `fetch` and
 * `Response`, while the check runner, the CLI and the HTTP API create and
 * inspect real ones, so the DOM is installed and then handed the originals
 * back.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const native = {
  fetch: globalThis.fetch,
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
  File: globalThis.File,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
};

GlobalRegistrator.register();
Object.assign(globalThis, native);

// Tells React that synchronous `act` scheduling is expected in these tests.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
