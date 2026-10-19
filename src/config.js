export const APP_SCHEMA = 1;
export const COOKIE_NAME = "__Host-cosmic_byok";
export const COOKIE_MAX_CHARS = 3800;
export const SESSION_SLIDING_SECONDS = 8 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
export const SESSION_RENEW_THRESHOLD_SECONDS = 60 * 60;
export const OPENAI_TRANSCRIPT_URL = "https://api.openai.com/v1/audio/transcriptions";
export const MAX_AUDIO_BYTES = 24_000_000;
export const DEFAULT_CHUNK_BYTES = 20_000_000;
export const MIN_CHUNK_BYTES = 5_000_000;
export const MAX_METADATA_JSON_BYTES = 12_000;
export const MAX_METADATA_HEADER_CHARS = 16_384;
export const MAX_UPSTREAM_RESPONSE_BYTES = 4 * 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_KEY_CHARS = 512;
export const MAX_PROMPT_CHARS = 12_000;
export const MAX_FINAL_PROMPT_CHARS = 16_000;
export const MAX_LANGUAGE_INPUT_CHARS = 128;
export const MAX_LANGUAGES = 16;
export const MAX_KEYWORD_INPUT_CHARS = 8_000;
export const MAX_KEYWORD_CHARS = 200;
export const MAX_KEYWORDS = 200;
export const MAX_JOB_ID_CHARS = 80;
export const MAX_FILE_ID_CHARS = 80;
export const MAX_ATTEMPT_ID_CHARS = 100;
export const MODEL_ALLOWLIST_REVISION = "2026-08-10-r4";
export const PRICING_LAST_VERIFIED = "2026-08-10";

export const MODELS = Object.freeze({
  "gpt-transcribe": Object.freeze({
    label: "GPT Transcribe",
    description: "Recommended general completed-file transcription model; supports multiple language hints, keywords and prompt context.",
    pricePerMinuteEstimate: 0.0045,
    priceBasis: "published_per_minute",
    languages: "plural",
    keywords: true,
    prompt: true,
    diarization: false,
    previousContext: true
  }),
  "gpt-4o-transcribe-diarize": Object.freeze({
    label: "GPT-4o Transcribe Diarize",
    description: "Speaker-labelled completed-file transcription with one optional ISO 639-1 language hint. Speaker identities are scoped to each independently diarized upload part.",
    pricePerMinuteEstimate: 0.006,
    priceBasis: "derived_same_audio_token_rates",
    languages: "single",
    keywords: false,
    prompt: false,
    diarization: true,
    previousContext: false
  }),
  "gpt-4o-transcribe": Object.freeze({
    label: "GPT-4o Transcribe",
    description: "High-quality completed-file speech transcription.",
    pricePerMinuteEstimate: 0.006,
    priceBasis: "published_per_minute",
    languages: "single",
    keywords: false,
    prompt: true,
    diarization: false,
    previousContext: true
  }),
  "gpt-4o-mini-transcribe": Object.freeze({
    label: "GPT-4o Mini Transcribe",
    description: "Lower-cost completed-file transcription model.",
    pricePerMinuteEstimate: 0.003,
    priceBasis: "published_per_minute",
    languages: "single",
    keywords: false,
    prompt: true,
    diarization: false,
    previousContext: true
  })
});

export const DEFAULT_MODEL = "gpt-transcribe";
