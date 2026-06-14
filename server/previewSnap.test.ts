import { describe, expect, it } from "vitest";
import { snapAxis, snapScale, snapAngle } from "../client/src/components/editor/PreviewStage";

describe("preview composition snapping", () => {
  it("snaps the box CENTER to canvas center (0.5)", () => {
    // width 0.4, left 0.30 → center exactly 0.50 (dist 0); edges land on 1/3 & 2/3
    // (dist 0.033) so center wins and pos is unchanged.
    const r = snapAxis(0.30, 0.4, 0.05);
    expect(r.guide).toBe(0.5);
    expect(r.pos).toBeCloseTo(0.3, 6);
  });

  it("snaps the LEFT edge to 0", () => {
    const r = snapAxis(0.02, 0.4, 0.05);
    expect(r.guide).toBe(0);
    expect(r.pos).toBeCloseTo(0, 6);
  });

  it("snaps the RIGHT edge to 1", () => {
    // width 0.4, left 0.58 → right 0.98, snaps right→1 → left 0.6
    const r = snapAxis(0.58, 0.4, 0.05);
    expect(r.guide).toBe(1);
    expect(r.pos).toBeCloseTo(0.6, 6);
  });

  it("snaps a thirds line (center → 1/3)", () => {
    // width 0.2, left 0.24 → center 0.34, near 1/3 ≈ 0.3333
    const r = snapAxis(0.24, 0.2, 0.05);
    expect(r.guide).toBeCloseTo(1 / 3, 6);
    expect(r.pos).toBeCloseTo(1 / 3 - 0.1, 6);
  });

  it("returns the input unchanged with no guide when nothing is within threshold", () => {
    const r = snapAxis(0.15, 0.1, 0.02); // left 0.15, center 0.2, right 0.25 — none near a target
    expect(r.guide).toBeNull();
    expect(r.pos).toBe(0.15);
  });

  it("snapScale snaps to tidy sizes within threshold, else leaves the value", () => {
    expect(snapScale(0.51, 0.02)).toBe(0.5);
    expect(snapScale(0.99, 0.02)).toBe(1);
    expect(snapScale(0.252, 0.02)).toBe(0.25);
    expect(snapScale(0.6, 0.02)).toBe(0.6); // 0.6 is >0.02 from 0.5/0.667 → unchanged
  });

  it("snapAngle snaps to 15° steps within threshold, else leaves the angle", () => {
    expect(snapAngle(2, 6)).toBe(0);
    expect(snapAngle(88, 6)).toBe(90);
    expect(snapAngle(46, 6)).toBe(45);
    expect(snapAngle(37, 6)).toBe(37);   // 37 is 7° from 30/45 → unchanged
    expect(snapAngle(-44, 6)).toBe(-45);
  });

  it("prefers the closest target when several are within threshold", () => {
    // width 0.5, left 0.01 → left 0.01 (near 0, dist .01), center 0.26 (near 1/3? .073), right 0.51 (near .5 dist .01)
    // left→0 and right→0.5 both dist .01; left found first but tie keeps first (dist strictly-less). left wins.
    const r = snapAxis(0.01, 0.5, 0.05);
    expect(r.guide).toBe(0);
  });
});
