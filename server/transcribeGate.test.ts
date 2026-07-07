import { describe, it, expect } from "vitest";
import { looksLikeAVContainer } from "./_core/voiceTranscription";

// 二进制 A/V 容器 magic 白名单：只有命中的才交给 ffmpeg 抽音轨；文本清单(m3u8/MPD/ffconcat/SDP)
// 与未知内容必须被拒（否则 ffmpeg/ffprobe 的 DASH/HLS 子解复用器会外连内网/元数据 → SSRF）。
const buf = (head: number[], padTo = 200): Buffer => {
  const b = Buffer.alloc(Math.max(padTo, head.length));
  head.forEach((v, i) => (b[i] = v));
  return b;
};
const ascii = (s: string, offset = 0, padTo = 200): Buffer => {
  const b = Buffer.alloc(padTo);
  b.write(s, offset, "latin1");
  return b;
};

describe("looksLikeAVContainer（转写抽音轨前的容器 magic 门）", () => {
  it("接受常见二进制 A/V 容器", () => {
    expect(looksLikeAVContainer(ascii("....ftypisom", 0))).toBe(true); // mp4/mov/m4a (ISO-BMFF)
    expect(looksLikeAVContainer(ascii("....moov", 0))).toBe(true);
    expect(looksLikeAVContainer(buf([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true); // matroska/webm
    expect(looksLikeAVContainer(ascii("RIFF....WAVE"))).toBe(true); // wav
    expect(looksLikeAVContainer(ascii("OggS"))).toBe(true); // ogg/opus
    expect(looksLikeAVContainer(ascii("fLaC"))).toBe(true); // flac
    expect(looksLikeAVContainer(ascii("ID3\x03"))).toBe(true); // mp3 + id3
    expect(looksLikeAVContainer(buf([0xff, 0xfb]))).toBe(true); // mp3 帧同步
    expect(looksLikeAVContainer(buf([0xff, 0xf1]))).toBe(true); // AAC ADTS
    expect(looksLikeAVContainer(ascii("#!AMR"))).toBe(true); // amr
    expect(looksLikeAVContainer(buf([0x30, 0x26, 0xb2, 0x75]))).toBe(true); // asf/wma
    expect(looksLikeAVContainer(buf([0x00, 0x00, 0x01, 0xba]))).toBe(true); // mpeg-ps
  });

  it("mpegts：需要 0/188 双同步字节", () => {
    const ts = Buffer.alloc(200); ts[0] = 0x47; ts[188] = 0x47;
    expect(looksLikeAVContainer(ts)).toBe(true);
    const notTs = Buffer.alloc(200); notTs[0] = 0x47; // 仅首字节 0x47（=ASCII 'G'），无 188 同步
    expect(looksLikeAVContainer(notTs)).toBe(false);
  });

  it("拒绝文本清单/引用型容器（SSRF 载体）", () => {
    expect(looksLikeAVContainer(ascii("#EXTM3U\n#EXTINF:10,\nhttp://169.254.169.254/x"))).toBe(false); // m3u8/hls
    expect(looksLikeAVContainer(ascii('<?xml version="1.0"?><MPD><BaseURL>http://169.254.169.254/</BaseURL></MPD>'))).toBe(false); // dash/mpd
    expect(looksLikeAVContainer(ascii("ffconcat version 1.0\nfile /etc/passwd"))).toBe(false); // concat
    expect(looksLikeAVContainer(ascii("v=0\no=- 0 0 IN IP4 127.0.0.1"))).toBe(false); // sdp
    expect(looksLikeAVContainer(ascii("<smil><video src='file:///etc/passwd'/></smil>"))).toBe(false); // smil xml
  });

  it("拒绝未知/过短内容", () => {
    expect(looksLikeAVContainer(Buffer.alloc(4))).toBe(false); // 过短(<12)
    expect(looksLikeAVContainer(ascii("hello world this is plain text"))).toBe(false);
    expect(looksLikeAVContainer(buf([0x12, 0x34, 0x56, 0x78, 0x9a]))).toBe(false); // 随机
  });

  it("m3u8 的 # 不会被 #!AMR 误当作音频", () => {
    expect(looksLikeAVContainer(ascii("#EXTM3U"))).toBe(false);
    expect(looksLikeAVContainer(ascii("#!AMR\n"))).toBe(true);
  });
});
