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
const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
  fetch?: typeof fetch;
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
  const name = transcriptErrorName(cause);

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

function transcriptErrorName(cause: unknown): string {
  if (!(cause instanceof Error)) return "";
  return cause.name !== "Error" ? cause.name : cause.constructor.name;
}

function namedTranscriptError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function captionRenderer(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const captions = value.captions;
  if (isRecord(captions) && isRecord(captions.playerCaptionsTracklistRenderer)) {
    return captions.playerCaptionsTracklistRenderer;
  }

  return isRecord(value.playerCaptionsTracklistRenderer)
    ? value.playerCaptionsTracklistRenderer
    : null;
}

function validCaptionTrackIndex(value: unknown, trackCount: number): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < trackCount
    ? value
    : undefined;
}

function defaultCaptionTrackIndex(renderer: Record<string, unknown>): number | undefined {
  if (!Array.isArray(renderer.captionTracks)) return undefined;

  const trackCount = renderer.captionTracks.length;
  const audioTracks = Array.isArray(renderer.audioTracks) ? renderer.audioTracks : [];
  const defaultAudioTrack =
    audioTracks.find((track) => isRecord(track) && track.hasDefaultTrack === true) ??
    audioTracks.find(
      (track) => isRecord(track) && Number.isInteger(track.defaultCaptionTrackIndex),
    ) ??
    audioTracks[0];

  if (isRecord(defaultAudioTrack)) {
    const explicitIndex = validCaptionTrackIndex(
      defaultAudioTrack.defaultCaptionTrackIndex,
      trackCount,
    );
    if (explicitIndex !== undefined) return explicitIndex;

    const associatedIndex = Array.isArray(defaultAudioTrack.captionTrackIndices)
      ? defaultAudioTrack.captionTrackIndices.find((index) =>
          validCaptionTrackIndex(index, trackCount) !== undefined,
        )
      : undefined;
    const validAssociatedIndex = validCaptionTrackIndex(associatedIndex, trackCount);
    if (validAssociatedIndex !== undefined) return validAssociatedIndex;
  }

  const explicitlyDefaultTrack = renderer.captionTracks.findIndex(
    (track) => isRecord(track) && (track.isDefault === true || track.default === true),
  );
  return validCaptionTrackIndex(explicitlyDefaultTrack, trackCount);
}

export function preferDefaultCaptionTrack(playerJson: unknown): unknown {
  const renderer = captionRenderer(playerJson);
  if (!renderer || !Array.isArray(renderer.captionTracks)) return playerJson;

  const defaultIndex = defaultCaptionTrackIndex(renderer);

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

function captionTracksFromPlayer(playerJson: unknown): Record<string, unknown>[] {
  const renderer = captionRenderer(playerJson);
  return renderer && Array.isArray(renderer.captionTracks)
    ? renderer.captionTracks.filter(isRecord)
    : [];
}

function captionTrackUrl(track: Record<string, unknown>): string | null {
  const value = track.baseUrl ?? track.url;
  return typeof value === "string" && value !== "" ? value : null;
}

function playerDetails(
  playerJson: unknown,
  videoId: string,
): Pick<TranscriptResult["videoDetails"], "title" | "author"> {
  const details = isRecord(playerJson) && isRecord(playerJson.videoDetails)
    ? playerJson.videoDetails
    : null;

  return {
    title: details && typeof details.title === "string" ? details.title : `YouTube video ${videoId}`,
    author: details && typeof details.author === "string" ? details.author : "",
  };
}

function extractJsonObjectAfterAssignment(body: string, variableName: string): unknown | null {
  const assignment = new RegExp(`(?:^|[^\\w])${variableName}\\s*=\\s*`, "u").exec(body);
  if (!assignment) return null;

  const start = assignment.index + assignment[0].length;
  const openingBrace = body.indexOf("{", start);
  if (openingBrace < 0) return null;

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = openingBrace; index < body.length; index += 1) {
    const character = body[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(openingBrace, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function playerResponseFromWatchPage(body: string): unknown | null {
  return extractJsonObjectAfterAssignment(body, "ytInitialPlayerResponse");
}

function numericValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function transcriptSegmentsFromBody(body: string, language: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/giu;

  for (const match of body.matchAll(textPattern)) {
    const attributes = match[1] ?? "";
    const text = match[2]
      ?.replace(/<\/?s\b[^>]*>/giu, "")
      .trim();
    const offset = attributes.match(/\bstart\s*=\s*["']([^"']+)["']/iu)?.[1];
    const duration = attributes.match(/\bdur\s*=\s*["']([^"']+)["']/iu)?.[1];
    const parsedOffset = numericValue(offset);
    const parsedDuration = numericValue(duration);

    if (text && parsedOffset !== undefined && parsedDuration !== undefined) {
      segments.push({
        text: decodeEntities(text),
        duration: parsedDuration,
        offset: parsedOffset,
        lang: language,
      });
    }
  }

  if (segments.length > 0) return segments;

  try {
    const json = JSON.parse(body);
    if (!isRecord(json) || !Array.isArray(json.events)) return [];

    for (const event of json.events) {
      if (!isRecord(event) || !Array.isArray(event.segs)) continue;

      const text = event.segs
        .filter(isRecord)
        .map((segment) => (typeof segment.utf8 === "string" ? segment.utf8 : ""))
        .join("")
        .trim();
      const startMilliseconds = numericValue(event.tStartMs);
      const durationMilliseconds = numericValue(event.dDurationMs);

      if (text && startMilliseconds !== undefined) {
        segments.push({
          text: decodeEntities(text),
          duration: durationMilliseconds !== undefined ? durationMilliseconds / 1_000 : 0,
          offset: startMilliseconds / 1_000,
          lang: language,
        });
      }
    }
  } catch {
    // The XML parser above is the normal path; malformed alternate formats are unavailable.
  }

  return segments;
}

async function fetchWatchPageTranscript(
  reference: YoutubeVideoReference,
  fetchImpl: typeof fetch,
): Promise<TranscriptPayload> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers = {
    "accept-language": "en-US,en;q=0.9",
    "user-agent": YOUTUBE_USER_AGENT,
  };
  const pageResponse = await fetchImpl(reference.canonicalUrl, { headers, signal });

  if (pageResponse.status === 429) {
    throw namedTranscriptError(
      "YoutubeTranscriptTooManyRequestError",
      "YouTube is receiving too many requests.",
    );
  }
  if (!pageResponse.ok) {
    throw namedTranscriptError(
      "YoutubeTranscriptVideoUnavailableError",
      `The video with ID "${reference.videoId}" is unavailable.`,
    );
  }

  const pageBody = await pageResponse.text();
  if (pageBody.includes('class="g-recaptcha"')) {
    throw namedTranscriptError(
      "YoutubeTranscriptTooManyRequestError",
      "YouTube is receiving too many requests.",
    );
  }

  const playerJson = playerResponseFromWatchPage(pageBody);
  if (!playerJson) {
    throw namedTranscriptError(
      "YoutubeTranscriptNotAvailableError",
      `No transcripts are available for the video with ID "${reference.videoId}".`,
    );
  }

  const playabilityStatus = isRecord(playerJson) && isRecord(playerJson.playabilityStatus)
    ? playerJson.playabilityStatus.status
    : undefined;
  if (typeof playabilityStatus === "string" && playabilityStatus !== "OK") {
    throw namedTranscriptError(
      "YoutubeTranscriptVideoUnavailableError",
      `The video with ID "${reference.videoId}" is unavailable.`,
    );
  }

  preferDefaultCaptionTrack(playerJson);
  const track = captionTracksFromPlayer(playerJson)[0];
  if (!track) {
    throw namedTranscriptError(
      "YoutubeTranscriptNotAvailableError",
      `No transcripts are available for the video with ID "${reference.videoId}".`,
    );
  }
  const transcriptUrl = track ? captionTrackUrl(track) : null;
  if (!transcriptUrl) {
    throw namedTranscriptError(
      "YoutubeTranscriptNotAvailableError",
      `No transcripts are available for the video with ID "${reference.videoId}".`,
    );
  }

  const transcriptResponse = await fetchImpl(transcriptUrl, { headers, signal });
  if (transcriptResponse.status === 429) {
    throw namedTranscriptError(
      "YoutubeTranscriptTooManyRequestError",
      "YouTube is receiving too many requests.",
    );
  }
  if (!transcriptResponse.ok) {
    throw namedTranscriptError(
      "YoutubeTranscriptNotAvailableError",
      `No transcripts are available for the video with ID "${reference.videoId}".`,
    );
  }

  const language = track.languageCode;
  const segments = transcriptSegmentsFromBody(
    await transcriptResponse.text(),
    typeof language === "string" && language !== "" ? language : "und",
  );
  if (segments.length === 0) {
    throw namedTranscriptError(
      "YoutubeTranscriptNotAvailableError",
      `No transcripts are available for the video with ID "${reference.videoId}".`,
    );
  }

  return {
    videoDetails: playerDetails(playerJson, reference.videoId),
    segments,
  };
}

const defaultTranscriptFetcher: TranscriptFetcher = async (videoId, options) => {
  const result = await fetchTranscript(videoId, options);
  if (Array.isArray(result)) {
    throw new Error("YouTube transcript metadata was missing.");
  }
  return result;
};

function isCaptionDiscoveryFailure(cause: unknown): boolean {
  const name = transcriptErrorName(cause);
  return name === "YoutubeTranscriptDisabledError" ||
    name === "YoutubeTranscriptNotAvailableError";
}

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
    const canUseWatchPageFallback =
      isCaptionDiscoveryFailure(cause) &&
      (options.fetchTranscript === undefined || options.fetch !== undefined);

    if (!canUseWatchPageFallback) {
      mapTranscriptFailure(cause);
    }

    try {
      payload = await fetchWatchPageTranscript(reference, options.fetch ?? fetch);
    } catch (fallbackCause) {
      mapTranscriptFailure(fallbackCause);
    }
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
