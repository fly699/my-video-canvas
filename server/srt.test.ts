import { describe, expect, it } from "vitest";
import { parseSrt } from "../shared/srt";

describe("parseSrt", () => {
  it("parses standard SRT blocks", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,500 --> 00:00:07,000\nSecond\nline\n";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Hello world" });
    expect(cues[1].start).toBe(5.5);
    expect(cues[1].text).toBe("Second\nline");
  });

  it("tolerates CRLF, BOM, WEBVTT header and dot millis", () => {
    const vtt = "﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.500\r\nHi there\r\n";
    const cues = parseSrt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toEqual({ start: 1, end: 2.5, text: "Hi there" });
  });

  it("skips malformed / zero-length / empty cues", () => {
    const srt = "1\nnot a timecode\nx\n\n2\n00:00:03,000 --> 00:00:03,000\nzero\n\n3\n00:00:08,000 --> 00:00:10,000\nok";
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("ok");
  });

  it("returns [] for empty / junk input", () => {
    expect(parseSrt("")).toEqual([]);
    expect(parseSrt("just some text\nno timecodes")).toEqual([]);
  });
});
