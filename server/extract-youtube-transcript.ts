import { fetchTranscript } from "youtube-transcript-plus";
import type {
  FetchParams,
  TranscriptConfig,
  TranscriptResult,
  TranscriptSegment,
} from "youtube-transcript-plus";
import type { ExtractedDocument } from "../shared/contracts.js";
import { ExtractionFailure } from "./errors.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

type TranscriptFetcher = (
  videoId: string,
  options: TranscriptConfig & { videoDetails: true },
) => Promise<TranscriptPayload>;

type TranscriptPayload = {
  videoDetails: Pick<TranscriptResult["videoDetails"], "title" | "author">;
  segments: TranscriptSegment[];
};

type ExtractYoutubeOptions = {
  fetchTranscript?: TranscriptFetcher;
  now?: () => Date;
};

export type YoutubeVideoReference = {
  videoId: string;
  canonicalUrl: string;
};

function invalidYoutubeUrl(message: string, cause?: unknown): never {
  throw new ExtractionFailure({
    code: "invalid_youtube_url",
    message,
    statusCode: 400,
    cause,
  });
}

export function parseYoutubeVideoUrl(value: string): YoutubeVideoReference {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    invalidYoutubeUrl("Enter a complete YouTube video URL.", cause);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    invalidYoutubeUrl("Only HTTP and HTTPS YouTube URLs are supported.");
  }

  const allowedPort =
    url.port === "" ||
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443");

  if (url.username || url.password || !allowedPort) {
    invalidYoutubeUrl("This YouTube URL format is not supported.");
  }

  const hostname = url.hostname.toLowerCase();
  let videoId: string | null = null;

  if (hostname === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1) videoId = parts[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(hostname)) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const [kind, id] = url.pathname.split("/").filter(Boolean);
      if (kind === "shorts" || kind === "embed" || kind === "live") {
        videoId = id ?? null;
      }
    }
  } else {
    invalidYoutubeUrl("Use a youtube.com or youtu.be video URL.");
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    invalidYoutubeUrl("This link does not identify a valid YouTube video.");
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return slug || "youtube-transcript";
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function decodeEntities(value: string): string {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["quot", '"'],
  ]);

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, key: string) => {
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    return named.get(key.toLowerCase()) ?? entity;
  });
}

function normalizeTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map(({ text }) =>
      decodeEntities(text)
        .replace(/[\u200B-\u200D\uFEFF]/gu, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

function sentencesFor(text: string, language: string): string[] {
  try {
    return [...new Intl.Segmenter(language === "und" ? "en" : language, {
      granularity: "sentence",
    }).segment(text)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  } catch {
    return text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  }
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/u);
  if (words.length <= 120) return [sentence];

  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 100) {
    chunks.push(words.slice(index, index + 100).join(" "));
  }
  return chunks;
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_\[\]])/gu, "\\$1")
    .replace(/^([#>+-])\s/gu, "\\$1 ");
}

export function transcriptParagraphs(segments: TranscriptSegment[]): string[] {
  const language = segments[0]?.lang || "und";
  const text = normalizeTranscriptText(segments);
  if (!text) return [];

  const units = sentencesFor(text, language).flatMap(splitLongSentence);
  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = wordCount(unit);
    if (current.length > 0 && (currentWords >= 70 || currentWords + unitWords > 120)) {
      paragraphs.push(escapeMarkdownText(current.join(" ")));
      current = [];
      currentWords = 0;
    }

    current.push(unit);
    currentWords += unitWords;
  }

  if (current.length > 0) paragraphs.push(escapeMarkdownText(current.join(" ")));
  return paragraphs;
}

type YoutubeMarkdownOptions = {
  title: string;
  author: string;
  canonicalUrl: string;
  language: string;
  segments: TranscriptSegment[];
  savedAt: Date;
};

export function buildYoutubeMarkdown(options: YoutubeMarkdownOptions): string {
  const paragraphs = transcriptParagraphs(options.segments);
  return [
    "---",
    `title: ${yamlValue(options.title)}`,
    "tags: []",
    `source: ${yamlValue(options.canonicalUrl)}`,
    `author: ${yamlValue(options.author)}`,
    `site: ${yamlValue("YouTube")}`,
    `language: ${yamlValue(options.language)}`,
    `saved: ${yamlValue(options.savedAt.toISOString())}`,
    `status: ${yamlValue("complete")}`,
    "---",
    "",
    `# ${options.title}`,
    "",
    "## Transcript",
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
  ].join("\n");
}

function mapTranscriptFailure(cause: unknown): never {
  const name = cause instanceof Error ? cause.constructor.name : "";

  if (name === "YoutubeTranscriptVideoUnavailableError") {
    throw new ExtractionFailure({
      code: "video_unavailable",
      message: "This YouTube video is private, unavailable, or no longer exists.",
      statusCode: 404,
      cause,
    });
  }

  if (name === "YoutubeTranscriptDisabledError" || name === "YoutubeTranscriptNotAvailableError") {
    throw new ExtractionFailure({
      code: "transcript_unavailable",
      message: "This video does not have an available transcript.",
      statusCode: 422,
      cause,
    });
  }

  if (name === "YoutubeTranscriptTooManyRequestError") {
    throw new ExtractionFailure({
      code: "youtube_rate_limited",
      message: "YouTube is temporarily limiting transcript requests. Try again later.",
      statusCode: 429,
      cause,
    });
  }

  if (cause instanceof Error && (cause.name === "AbortError" || name === "AbortError")) {
    throw new ExtractionFailure({
      code: "transcript_timeout",
      message: "YouTube did not return the transcript within 15 seconds.",
      statusCode: 504,
      cause,
    });
  }

  throw new ExtractionFailure({
    code: "transcript_fetch_failed",
    message: "The transcript could not be retrieved from YouTube.",
    statusCode: 502,
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function preferDefaultCaptionTrack(playerJson: unknown): unknown {
  if (!isRecord(playerJson) || !isRecord(playerJson.captions)) return playerJson;
  const renderer = playerJson.captions.playerCaptionsTracklistRenderer;
  if (!isRecord(renderer) || !Array.isArray(renderer.captionTracks)) return playerJson;

  const audioTracks = Array.isArray(renderer.audioTracks) ? renderer.audioTracks : [];
  const defaultTrack = audioTracks.find(
    (track) => isRecord(track) && Number.isInteger(track.defaultCaptionTrackIndex),
  );
  const defaultIndex = isRecord(defaultTrack) ? defaultTrack.defaultCaptionTrackIndex : undefined;

  if (
    typeof defaultIndex === "number" &&
    defaultIndex > 0 &&
    defaultIndex < renderer.captionTracks.length
  ) {
    const [track] = renderer.captionTracks.splice(defaultIndex, 1);
    renderer.captionTracks.unshift(track);
  }

  return playerJson;
}

async function fetchPlayerWithDefaultTrack(params: FetchParams): Promise<Response> {
  const url = new URL(params.url);
  if (url.protocol !== "https:" || url.hostname !== "www.youtube.com") {
    throw new Error("Unexpected YouTube player endpoint.");
  }

  const response = await fetch(url, {
    method: params.method,
    headers: {
      ...params.headers,
      ...(params.lang ? { "accept-language": params.lang } : {}),
      ...(params.userAgent ? { "user-agent": params.userAgent } : {}),
    },
    body: params.body,
    signal: params.signal,
  });
  const body = await response.text();

  try {
    const playerJson: unknown = JSON.parse(body);
    return new Response(JSON.stringify(preferDefaultCaptionTrack(playerJson)), {
      status: response.status,
      statusText: response.statusText,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  }
}

const defaultTranscriptFetcher: TranscriptFetcher = async (videoId, options) => {
  const result = await fetchTranscript(videoId, options);
  if (Array.isArray(result)) {
    throw new Error("YouTube transcript metadata was missing.");
  }
  return result;
};

export async function extractYoutubeTranscript(
  input: string,
  options: ExtractYoutubeOptions = {},
): Promise<ExtractedDocument> {
  const reference = parseYoutubeVideoUrl(input);
  const transcriptFetcher = options.fetchTranscript ?? defaultTranscriptFetcher;
  let payload: TranscriptPayload;

  try {
    payload = await transcriptFetcher(reference.videoId, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      retries: 1,
      retryDelay: 500,
      videoDetails: true,
      playerFetch: fetchPlayerWithDefaultTrack,
    });
  } catch (cause) {
    mapTranscriptFailure(cause);
  }

  const segments = payload.segments.filter(({ text }) => text.trim() !== "");
  if (segments.length === 0) {
    throw new ExtractionFailure({
      code: "transcript_unavailable",
      message: "This video does not have an available transcript.",
      statusCode: 422,
    });
  }

  const title = payload.videoDetails.title.trim() || `YouTube video ${reference.videoId}`;
  const author = payload.videoDetails.author.trim();
  const language = segments[0]?.lang || "und";
  const plainText = normalizeTranscriptText(segments);
  const markdown = buildYoutubeMarkdown({
    title,
    author,
    canonicalUrl: reference.canonicalUrl,
    language,
    segments,
    savedAt: (options.now ?? (() => new Date()))(),
  });

  return {
    title,
    author,
    source: "YouTube",
    published: "",
    canonicalUrl: reference.canonicalUrl,
    markdown,
    filename: `${slugify(title)}.md`,
    wordCount: wordCount(plainText),
    status: { kind: "complete" },
  };
}
