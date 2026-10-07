import { describe, expect, it } from "vitest";
import {
  addDays,
  collectIsoDates,
  extractAuthTokens,
  extractLogIds,
  extractLogs,
  groupDatesByMonth,
  midpointDate,
  resolveBabyId,
} from "./lib.mjs";

describe("Napper backup helpers", () => {
  it("collects ISO dates from nested keys and values", () => {
    const dates = collectIsoDates({
      item: {
        "2026-10-01": true,
        rows: [
          { date: "2026-10-02T12:30:00Z" },
          { nested: { day: "not-a-date" } },
        ],
      },
    });

    expect([...dates].sort()).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("extracts nested logs without changing the raw payload", () => {
    const response = {
      item: {
        logs: [{ id: "a" }, { logId: "b" }],
        another: { logs: [{ uuid: "c" }] },
      },
    };

    expect(extractLogs(response)).toHaveLength(3);
    expect([...extractLogIds(response)].sort()).toEqual(["a", "b", "c"]);
  });

  it("extracts tokens from Napper auth responses", () => {
    expect(
      extractAuthTokens({
        item: {
          idToken: { token: "id-token", payload: {} },
          refreshToken: { token: "refresh-token", payload: {} },
        },
      }),
    ).toEqual({
      idToken: "id-token",
      refreshToken: "refresh-token",
    });
  });

  it("resolves a unique baby by exact or partial name", () => {
    const response = {
      item: [
        { id: "baby-a", name: "Alex" },
        { id: "baby-b", name: "Beatrice" },
      ],
    };

    expect(resolveBabyId(response, { babyName: "Beatrice" })).toBe("baby-b");
    expect(resolveBabyId(response, { babyName: "bea" })).toBe("baby-b");
  });

  it("groups discovered dates by calendar month", () => {
    const groups = groupDatesByMonth([
      "2026-10-03",
      "2026-09-30",
      "2026-10-01",
    ]);

    expect([...groups.entries()]).toEqual([
      ["2026-09", ["2026-09-30"]],
      ["2026-10", ["2026-10-01", "2026-10-03"]],
    ]);
  });

  it("splits date ranges without overlapping the second half", () => {
    const midpoint = midpointDate("2026-01-01", "2026-01-31");
    expect(midpoint).toBe("2026-01-16");
    expect(addDays(midpoint, 1)).toBe("2026-01-17");
  });
});
