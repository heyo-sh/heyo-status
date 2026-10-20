import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { DaySnapshot } from "../src/types";
import { DayGrid } from "../src/ui/day-grid";

const days: DaySnapshot[] = [
  {
    key: "2026-01-11",
    label: "Jan 11, 2026",
    status: "up",
    tooltip: "100% uptime — 5 checks",
    totalChecks: 5,
    downChecks: 0,
    downMinutes: 0,
    downPercent: 0,
  },
  {
    key: "2026-01-12",
    label: "Jan 12, 2026",
    status: "degraded",
    tooltip: "60% uptime — 5 checks — 2 failures",
    totalChecks: 5,
    downChecks: 2,
    downMinutes: 42,
    downPercent: 40,
  },
  {
    key: "2026-01-13",
    label: "Jan 13, 2026",
    status: "down",
    tooltip: "0% uptime — 1 check — 1 failure",
    totalChecks: 1,
    downChecks: 1,
    downMinutes: 1,
    downPercent: 100,
  },
  {
    key: "2026-01-14",
    label: "Jan 14, 2026",
    status: "empty",
    tooltip: "No data for Jan 14, 2026",
    totalChecks: 0,
    downChecks: 0,
    downMinutes: 0,
    downPercent: 0,
  },
];

let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("daily tooltip uses a full UTC date and separate status and metrics lines", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<DayGrid days={days} monitorName="Website" />));

  const ticks = [
    ...container.querySelectorAll<HTMLButtonElement>("button[data-status]"),
  ];
  expect(ticks).toHaveLength(4);
  expect(ticks[1]?.getAttribute("aria-label")).toContain("40% unavailable");

  async function focusTick(index: number): Promise<HTMLElement> {
    await act(async () => {
      ticks[index]!.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const popup = document.querySelector<HTMLElement>('[data-slot="tooltip"]');
    expect(popup).not.toBeNull();
    return popup!;
  }

  let popup = await focusTick(1);
  expect(popup.textContent).toContain("Monday, January 12th, 2026");
  expect(popup.textContent).toContain("DOWN for 42 minutes");
  expect(popup.textContent).toContain("60% uptime · 40% unavailable");
  expect(popup.textContent).toContain("5 checks · 2 failures");
  expect(popup.querySelector("span.flex-col")?.children).toHaveLength(4);

  popup = await focusTick(2);
  expect(popup.textContent).toContain("Tuesday, January 13th, 2026");
  expect(popup.textContent).toContain("DOWN for 1 minute");
  expect(popup.textContent).toContain("1 check · 1 failure");

  popup = await focusTick(0);
  expect(popup.textContent).toContain("Sunday, January 11th, 2026");
  expect(popup.textContent).toContain("Status OK");
  expect(popup.textContent).toContain("100% uptime · 0% unavailable");

  popup = await focusTick(3);
  expect(popup.textContent).toContain("Wednesday, January 14th, 2026");
  expect(popup.textContent).toContain("No checks");
  expect(popup.textContent).not.toContain("0% unavailable");
});
