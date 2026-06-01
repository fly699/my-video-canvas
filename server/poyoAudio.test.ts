import { describe, expect, it } from "vitest";
import { IN_PROGRESS_STATUSES } from "./_core/poyoAudio";

describe("poyoAudio polling statuses", () => {
  it("treats not_started as in-progress (Poyo's initial queued state), not terminal", () => {
    // Regression: a freshly-submitted Poyo TTS/music task returns status
    // "not_started"; it must be polled through, not surfaced as a failure.
    expect(IN_PROGRESS_STATUSES.has("not_started")).toBe(true);
    expect(IN_PROGRESS_STATUSES.has("running")).toBe(true);
  });
});
