import { describe, expect, test } from "bun:test";

import { createId } from "../src/ids";

/**
 * Incidents, updates, maintenance windows and delivery records are all listed
 * with the identifier as the tie-breaker of a timestamp column. A random
 * identifier made that tie-break arbitrary, so records written in the same
 * millisecond — which one check run does routinely — could be published out of
 * order.
 */
describe("record identifiers", () => {
  test("sort lexicographically in creation order", () => {
    const created = Array.from({ length: 500 }, () => createId("inc"));

    expect([...created].sort()).toEqual(created);
    expect(new Set(created).size).toBe(created.length);
  });

  test("stay ordered when the clock repeats or steps backwards", () => {
    const sameMillisecond = [
      createId("upd", 1_800_000_000_000),
      createId("upd", 1_800_000_000_000),
      createId("upd", 1_800_000_000_000),
    ];
    // A backwards clock must not reorder records that were already written.
    const afterRewind = createId("upd", 1_700_000_000_000);
    const ordered = [...sameMillisecond, afterRewind];

    expect([...ordered].sort()).toEqual(ordered);
  });

  test("keep their prefix and 128 bits of unguessable suffix", () => {
    const id = createId("sub");
    const [prefix, body] = id.split("_");

    expect(prefix).toBe("sub");
    // 9 timestamp characters, 4 ordinal characters, 32 hexadecimal characters.
    expect(body).toMatch(/^[\da-z]{13}[\da-f]{32}$/);
  });
});
