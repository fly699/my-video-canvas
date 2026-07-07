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
import { resolveToAbsoluteUrl, toInternalStoragePath, isOwnStorageUrl } from "../storage";
import { assertPublicUrl } from "./ssrfGuard";

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

    // Step 2: Download audio from URL.
    // Our own /manus-storage/ proxy URL (relative OR absolute same-origin) is
    // trusted internal storage — resolve it to a fetchable presigned URL and
    // skip the SSRF guard (host discarded, only our key is used). Everything
    // else is guarded against SSRF to private/local network addresses.
    let audioUrl = options.audioUrl;
    const internal = toInternalStoragePath(audioUrl);
    if (internal) {
      audioUrl = await resolveToAbsoluteUrl(internal);
    } else if (!isOwnStorageUrl(audioUrl)) {
      try {
        // Strong shared guard (covers integer/hex IPv4 the old regex missed).
        assertPublicUrl(audioUrl);
      } catch {
        return { error: "Invalid audio URL", code: "INVALID_FORMAT" as const, details: "Could not parse URL" };
      }
    }
    const wasExternal = !internal && !isOwnStorageUrl(options.audioUrl);
    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      const response = await fetch(audioUrl);
      // SSRF: re-validate post-redirect URL — internal responses transcribed back
      // to the user are a direct exfiltration channel.
      if (wasExternal && response.url) {
        try { assertPublicUrl(response.url); }
        catch { return { error: "Invalid audio URL", code: "INVALID_FORMAT" as const, details: "Redirect to private host blocked" }; }
      }
      if (!response.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      
      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get('content-type') || 'audio/mpeg';
      
      // Check file size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
        };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Step 3: Create FormData for multipart upload to Whisper API
    const formData = new FormData();
    
    // Create a Blob from the buffer and append to form
    const filename = `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, filename);
    
    // 词级时间戳仅 whisper-1 保证返回 words[]——请求词级时强制该模型（gpt-4o-transcribe 不保证）。
    formData.append("model", options.wordTimestamps ? "whisper-1" : (options.model || "whisper-1"));
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
    'audio/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
  };
  
  return mimeToExt[mimeType] || 'audio';
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
