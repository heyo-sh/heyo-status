import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { SubscribeDialog } from "../src/ui/subscribe-dialog";

// The document comes from `test/setup-dom.ts`, which Bun preloads before it
// imports any test file. Registering it here would be too late for Base UI.

const roots: Array<{ unmount(): void }> = [];

afterEach(() => {
  unmountAll();
  document.body.innerHTML = "";
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

function unmountAll(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="dialog"]');
}

/**
 * The dialog itself — focus capture, Escape, the inert backdrop — is heyo-ui's
 * `Dialog`. What is tested here is the part Heyo Status owns: the dialog is
 * reachable, labelled, and renders exactly the methods a page enabled.
 */
describe("SubscribeDialog", () => {
  test("renders a labelled modal with the enabled methods", () => {
    mount(
      <SubscribeDialog
        methods={["email", "rss", "webhook"]}
        onOpenChange={() => {}}
        open
      />,
    );

    const popup = dialog();
    expect(popup?.getAttribute("role")).toBe("dialog");
    expect(popup?.textContent).toContain("Subscribe to updates");
    expect(popup?.textContent).toContain("Email address");
    expect(
      [...popup!.querySelectorAll('[data-slot="tabs-tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["Email", "RSS", "Webhook"]);
  });

  test("closes on Escape", () => {
    let open = true;
    mount(
      <SubscribeDialog
        methods={["email"]}
        onOpenChange={(next) => {
          open = next;
        }}
        open
      />,
    );

    act(() => {
      dialog()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(open).toBe(false);
  });

  // A single enabled method has nothing to switch between, and a one-tab
  // tablist is noise for a screen reader.
  test("omits the method tabs when only one method is enabled", () => {
    mount(<SubscribeDialog methods={["email"]} onOpenChange={() => {}} open />);

    expect(dialog()?.querySelector('[data-slot="tabs-tab"]')).toBeNull();
    expect(dialog()?.textContent).toContain("Email address");
  });

  // The feed links are the one method that needs no request, so they must work
  // without the form — and without JavaScript having to reach the API.
  test("offers feed links instead of a form for RSS", () => {
    mount(
      <SubscribeDialog
        basePath="/api/status"
        methods={["rss"]}
        onOpenChange={() => {}}
        open
      />,
    );

    const links = [...(dialog()?.querySelectorAll("a") ?? [])].map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(["/api/status/rss.xml", "/api/status/atom.xml"]);
    expect(dialog()?.querySelector("form")).toBeNull();
  });

  test("rejects an invalid target before sending a request", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;

    try {
      mount(
        <SubscribeDialog methods={["email"]} onOpenChange={() => {}} open />,
      );
      const input = dialog()!.querySelector("input")!;
      act(() => {
        setInputValue(input, "not-an-email");
      });
      await act(async () => {
        dialog()!
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true }));
      });

      expect(calls).toEqual([]);
      expect(dialog()?.textContent).toContain("Enter a valid email address.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("posts a valid subscription and reports the pending confirmation", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return new Response("{}", { status: 202 });
    }) as typeof fetch;

    try {
      mount(
        <SubscribeDialog
          basePath="/api/status"
          methods={["email"]}
          onOpenChange={() => {}}
          open
        />,
      );
      const input = dialog()!.querySelector("input")!;
      act(() => {
        setInputValue(input, "reader@example.com");
      });
      await act(async () => {
        dialog()!
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true }));
      });

      expect(requests).toEqual([
        {
          url: "/api/status/subscribers",
          body: { type: "email", target: "reader@example.com" },
        },
      ]);
      expect(dialog()?.textContent).toContain(
        "If needed, check your email to confirm the subscription.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/** React tracks the value internally, so a plain assignment is not observed. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
