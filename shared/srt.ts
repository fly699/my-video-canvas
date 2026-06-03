// SRT / WebVTT cue parser. Used by the editor's "导入 SRT" to lay timed text
// clips onto the text track. Tolerant: accepts comma or dot millisecond
// separators, optional index lines, BOM, CRLF, and a leading "WEBVTT" header.

export interface SubtitleCue {
  start: number; // seconds
  end: number;   // seconds
  text: string;  // may contain newlines
}

/** "HH:MM:SS,mmm" / "MM:SS.mmm" / "SS,mmm" → seconds, or null if unparseable. */
function parseTimecode(tc: string): number | null {
  const m = tc.trim().replace(",", ".").match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  if (Number.isNaN(min) || Number.isNaN(sec)) return null;
  return h * 3600 + min * 60 + sec;
}

const ARROW = /\s*-->\s*/;

export function parseSrt(input: string): SubtitleCue[] {
  if (!input) return [];
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/^WEBVTT.*\n/i, "");
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l, i) => !(i === 0 && l.trim() === ""));
    if (lines.length === 0) continue;
    // The timecode line is the first line containing "-->".
    let tcIdx = lines.findIndex((l) => ARROW.test(l) && l.includes("-->"));
    if (tcIdx < 0) continue;
    const [rawStart, rawEnd] = lines[tcIdx].split(ARROW);
    const start = parseTimecode(rawStart ?? "");
    // WebVTT cue settings may trail the end timecode ("... --> 00:02.000 line:90%").
    const end = parseTimecode((rawEnd ?? "").split(/\s+/)[0] ?? "");
    if (start == null || end == null || end <= start) continue;
    const body = lines.slice(tcIdx + 1).join("\n").trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}
