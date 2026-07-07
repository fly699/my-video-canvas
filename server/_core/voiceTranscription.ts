/**
 * Voice transcription helper using internal Speech-to-Text service
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 * 
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text); // Full transcription
 *     console.log(data.language); // Detected language
 *     console.log(data.segments); // Timestamped segments
 *   }
 * });
 * 
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import { ENV } from "./env";
import { promises as fs } from "node:fs";
import { downloadToTemp, execFileAsync } from "./videoEditor";

export type TranscribeOptions = {
  audioUrl: string; // URL to the audio file (e.g., S3 URL)
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
  model?: string; // 转录模型（OpenAI 兼容：whisper-1 / gpt-4o-transcribe / gpt-4o-mini-transcribe）；缺省 whisper-1
  /** 需要【词级】时间戳（AI 智能剪辑按词边界切、逐词字幕的硬前提）。开启则请求
   *  timestamp_granularities[]=word（仅 whisper-1 保证返回 words[]，故强制 whisper-1）。 */
  wordTimestamps?: boolean;
};

/** 词级时间戳条目（whisper-1 + timestamp_granularities=word 时返回于顶层 words[]）。 */
export type WhisperWord = { word: string; start: number; end: number };

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
  /** 词级时间戳（仅 wordTimestamps=true 且模型返回时存在）。 */
  words?: WhisperWord[];
};

export type TranscriptionResponse = WhisperResponse; // Return native Whisper API response directly

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

/**
 * Transcribe audio to text using the internal Speech-to-Text service
 * 
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
/** 解析转写端点（OpenAI 兼容 /v1/audio/transcriptions）。优先级：
 *  1) TRANSCRIBE_API_URL + TRANSCRIBE_API_KEY（显式覆盖，可指自建 whisper）
 *  2) 内置 Forge（BUILT_IN_FORGE_API_URL + KEY）
 *  3) OpenAI 官方（OPENAI_API_KEY；用户常已为 TTS 配音设了它）
 *  三者皆无 → null（调用方回退「未配置」错误）。 */
export function resolveTranscribeEndpoint(): { baseUrl: string; apiKey: string } | null {
  if (ENV.transcribeApiUrl && ENV.transcribeApiKey) return { baseUrl: ENV.transcribeApiUrl, apiKey: ENV.transcribeApiKey };
  if (ENV.forgeApiUrl && ENV.forgeApiKey) return { baseUrl: ENV.forgeApiUrl, apiKey: ENV.forgeApiKey };
  if (ENV.openaiApiKey) return { baseUrl: "https://api.openai.com", apiKey: ENV.openaiApiKey };
  return null;
}

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Resolve the transcription endpoint (Forge / OpenAI / explicit override).
    const endpoint = resolveTranscribeEndpoint();
    if (!endpoint) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "请设置以下之一：OPENAI_API_KEY（走 OpenAI 官方 whisper-1）、BUILT_IN_FORGE_API_URL+BUILT_IN_FORGE_API_KEY、或 TRANSCRIBE_API_URL+TRANSCRIBE_API_KEY（自建 OpenAI 兼容转写端点）",
      };
    }

    // Step 2: 抽音轨（与 video-use 一致：先 ffmpeg 从视频/音频提取纯音频，再转写）。
    // 归一到 16kHz 单声道 mp3 —— 既满足转写端点的格式白名单（原来把整段视频丢给 Groq，
    // 它按扩展名严格校验直接 400），又把长视频体积压到极小。downloadToTemp 内含 SSRF 防护
    // 与我方存储解析（含 302 重定向复检）。ffmpeg 缺失/源无音轨/解码失败时回退：直接送
    // 原文件（用修正后的合法扩展名）。
    let payload: { buffer: Buffer; filename: string; mime: string } | null = null;
    let srcTemp: string | null = null;
    let audioTemp: string | null = null;
    try {
      try {
        srcTemp = await downloadToTemp(options.audioUrl, "src");
      } catch (dlErr) {
        return { error: "Failed to fetch audio file", code: "SERVICE_ERROR", details: dlErr instanceof Error ? dlErr.message.slice(0, 200) : "download failed" };
      }
      audioTemp = `${srcTemp}.mp3`;
      try {
        await execFileAsync("ffmpeg", ["-y", "-i", srcTemp, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", audioTemp], { timeoutMs: 180000 });
        const audioBuf = await fs.readFile(audioTemp);
        if (!audioBuf.length) throw new Error("提取到空音频（源可能无音轨）");
        const sizeMB = audioBuf.length / (1024 * 1024);
        if (sizeMB > 24) {
          return { error: "Audio too long for transcription", code: "FILE_TOO_LARGE", details: `提取音频 ${sizeMB.toFixed(1)}MB 超过转写上限，请剪短或分段后再试` };
        }
        payload = { buffer: audioBuf, filename: "audio.mp3", mime: "audio/mpeg" };
      } catch (ffErr) {
        // 回退：ffmpeg 缺失/源无音轨/解码失败 → 直接送原文件（修正为合法扩展名）
        const raw = await fs.readFile(srcTemp);
        if (raw.length / (1024 * 1024) > 16) {
          return { error: "Audio file exceeds maximum size limit", code: "FILE_TOO_LARGE", details: `无法提取音频（${ffErr instanceof Error ? ffErr.message.slice(0, 80) : "ffmpeg 失败"}），且原文件 > 16MB` };
        }
        payload = { buffer: raw, filename: `audio.${resolveTranscribeExt(options.audioUrl, "")}`, mime: "application/octet-stream" };
      }
    } finally {
      if (srcTemp) fs.unlink(srcTemp).catch(() => { /* best-effort cleanup */ });
      if (audioTemp) fs.unlink(audioTemp).catch(() => { /* best-effort cleanup */ });
    }
    if (!payload) return { error: "Failed to prepare audio", code: "SERVICE_ERROR", details: "no payload" };

    // Step 3: Create FormData for multipart upload to the transcription API.
    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(payload.buffer)], { type: payload.mime });
    formData.append("file", audioBlob, payload.filename);

    // 模型优先级：**节点显式选择 > TRANSCRIBE_MODEL（部署默认）> whisper-1**。
    // 节点保留自选模型的自由；仅当节点未指定时才用部署默认（如指向 Groq 的 whisper-large-v3），
    // 都没有则回落官方 whisper-1（词级时间戳的稳妥选择）。
    const model = (options.model?.trim() || ENV.transcribeModel.trim() || "whisper-1");
    formData.append("model", model);
    formData.append("response_format", "verbose_json");
    if (options.wordTimestamps) {
      // OpenAI 数组参数按重复字段追加；同时要 word 与 segment（保留段级便于分句/静音判断）。
      formData.append("timestamp_granularities[]", "word");
      formData.append("timestamp_granularities[]", "segment");
    }

    // Add prompt - use custom prompt if provided, otherwise generate based on language
    const prompt = options.prompt || (
      options.language 
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text"
    );
    formData.append("prompt", prompt);

    if (options.language) {
      formData.append("language", options.language);
    }

    // Step 4: Call the transcription service (resolved endpoint from Step 1)
    const baseUrl = endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`;
    const fullUrl = new URL("v1/audio/transcriptions", baseUrl).toString();

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.apiKey}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      let host = baseUrl; try { host = new URL(baseUrl).host; } catch { /* keep */ }
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `[${host}] ${response.status} ${response.statusText}${errorText ? `: ${errorText.slice(0, 300)}` : ""}`
      };
    }

    // Step 5: Parse and return the transcription result
    const whisperResponse = await response.json() as WhisperResponse;
    
    // Validate response structure
    if (!whisperResponse.text || typeof whisperResponse.text !== 'string') {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }

    return whisperResponse; // Return native Whisper API response directly

  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

/**
 * Helper function to get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/webm': 'webm', 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3',
    'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg',
    'audio/m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/flac': 'flac', 'audio/x-m4a': 'm4a',
    // 视频容器（回退直送时用）：Groq/OpenAI 白名单里的都可原样送。
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/mpeg': 'mpeg', 'video/quicktime': 'mp4',
  };
  // content-type 可能带 "; codecs=…"，取分号前主类型再小写。
  return mimeToExt[mimeType.split(';')[0].trim().toLowerCase()] || 'mp4';
}

// 转写端点（尤其 Groq）按扩展名严格校验；这是它们接受的集合。
const TR_OK_EXT = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm']);

/** 回退直送原文件时，推断一个合法扩展名：优先 URL 路径后缀，其次 content-type，兜底 mp4。 */
function resolveTranscribeExt(url: string, mimeType: string): string {
  try {
    const p = new URL(url, "http://x").pathname;
    const m = /\.([a-z0-9]{2,5})$/i.exec(p);
    if (m) { const e = m[1].toLowerCase(); if (TR_OK_EXT.has(e)) return e; if (e === "mov") return "mp4"; }
  } catch { /* relative/opaque URL */ }
  const e2 = getFileExtension(mimeType);
  return TR_OK_EXT.has(e2) ? e2 : "mp4";
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
  };
  
  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 * 
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 * 
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *       
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *       
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *       
 *       return result;
 *     }),
 * });
 * ```
 */
