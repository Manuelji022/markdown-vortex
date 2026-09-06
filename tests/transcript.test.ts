import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedDocument, ExtractionApiResponse } from "../shared/contracts.js";
import {
  buildYoutubeMarkdown,
  extractYoutubeTranscript,
  parseYoutubeVideoUrl,
  preferDefaultCaptionTrack,
  transcriptParagraphs,
} from "../server/extract-youtube-transcript.js";
import { ExtractionFailure } from "../server/errors.js";
import { registerTranscriptRoute } from "../server/transcript-route.js";

const videoId = "aircAruvnKk";
const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
const segments = [
  {
    text: "Neural networks are inspired by the brain, but their structure is built from layers of simple calculations.",
    duration: 4,
    offset: 0,
    lang: "en",
  },
  {
    text: "Each connection carries a number called a weight, and learning means finding useful values for those weights.",
    duration: 5,
    offset: 4,
    lang: "en",
  },
];

describe("YouTube URL validation", () => {
  it.each([
    `https://www.youtube.com/watch?v=${videoId}&list=example`,
    `https://youtu.be/${videoId}?si=example`,
    `https://m.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
    `https://youtube.com/live/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
  ])("canonicalizes supported video URL %s", (value) => {
    expect(parseYoutubeVideoUrl(value)).toEqual({ videoId, canonicalUrl });
  });

  it.each([
    "https://example.com/watch?v=aircAruvnKk",
    "https://youtube.com.evil.example/watch?v=aircAruvnKk",
    "https://youtube.com/playlist?list=example",
    "https://youtube.com/@example",
    "file:///aircAruvnKk",
    "https://youtube.com/watch?v=too-short",
  ])("rejects unsupported URL %s", (value) => {
    expect(() => parseYoutubeVideoUrl(value)).toThrowError(
      expect.objectContaining({ code: "invalid_youtube_url" }),
    );
  });
});

describe("YouTube Markdown formatting", () => {
  it("builds readable paragraphs and escaped frontmatter", () => {
    const markdown = buildYoutubeMarkdown({
      title: "Weights: a visual guide",
      author: "Example Channel",
      canonicalUrl,
      language: "en",
      segments,
      savedAt: new Date("2026-09-06T12:00:00.000Z"),
    });

    expect(markdown).toContain('title: "Weights: a visual guide"');
    expect(markdown).toContain('author: "Example Channel"');
    expect(markdown).toContain('language: "en"');
    expect(markdown).toContain("## Transcript");
    expect(markdown).not.toMatch(/\[00:/u);
  });

  it("packs long caption runs into bounded paragraphs", () => {
    const longSegments = Array.from({ length: 20 }, (_, index) => ({
      text: `Sentence ${index + 1} contains several useful words for a readable transcript paragraph.`,
      duration: 3,
      offset: index * 3,
      lang: "en",
    }));
    const paragraphs = transcriptParagraphs(longSegments);

    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((paragraph) => paragraph.split(/\s+/u).length <= 120)).toBe(true);
  });
});

describe("YouTube caption selection", () => {
  it("moves YouTube's declared default caption track to the front", () => {
    const playerJson = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { languageCode: "ar" },
            { languageCode: "es" },
            { languageCode: "en" },
          ],
          audioTracks: [{ defaultCaptionTrackIndex: 2 }],
        },
      },
    };

    preferDefaultCaptionTrack(playerJson);

    expect(playerJson.captions.playerCaptionsTracklistRenderer.captionTracks[0]).toEqual({
      languageCode: "en",
    });
  });

  it("uses the caption track associated with the default audio track", () => {
    const playerJson = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: "ar" }, { languageCode: "es" }],
          audioTracks: [
            { captionTrackIndices: [1], hasDefaultTrack: true },
            { captionTrackIndices: [0] },
          ],
        },
      },
    };

    preferDefaultCaptionTrack(playerJson);

    expect(playerJson.captions.playerCaptionsTracklistRenderer.captionTracks[0]).toEqual({
      languageCode: "es",
    });
  });
});

describe("YouTube transcript extraction", () => {
  it("returns the shared Markdown document contract", async () => {
    const transcriptFetcher = vi.fn(async () => ({
      videoDetails: { title: "A visual guide", author: "Example Channel" },
      segments,
    }));

    const document = await extractYoutubeTranscript(canonicalUrl, {
      fetchTranscript: transcriptFetcher,
      now: () => new Date("2026-09-06T12:00:00.000Z"),
    });

    expect(transcriptFetcher).toHaveBeenCalledWith(
      videoId,
      expect.objectContaining({ videoDetails: true, retries: 1, retryDelay: 500 }),
    );
    expect(document).toMatchObject({
      title: "A visual guide",
      author: "Example Channel",
      source: "YouTube",
      canonicalUrl,
      filename: "a-visual-guide.md",
      status: { kind: "complete" },
    });
    expect(document.wordCount).toBeGreaterThan(20);
  });

  it("falls back to captions exposed in the watch page", async () => {
    const fallbackTrackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`;
    const watchPage = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      playabilityStatus: { status: "OK" },
      videoDetails: { title: "Fallback video", author: "Fallback channel" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ languageCode: "en", baseUrl: fallbackTrackUrl }],
          audioTracks: [{ captionTrackIndices: [0], hasDefaultTrack: true }],
        },
      },
    })};</script>`;
    const fetchTranscriptMock = vi.fn(async () => {
      const NotAvailableError = class YoutubeTranscriptNotAvailableError extends Error {};
      throw new NotAvailableError();
    });
    const fetchMock: typeof fetch = vi.fn(async (input) =>
      String(input) === canonicalUrl
        ? new Response(watchPage)
        : new Response(
            '<transcript><text start="0" dur="2">Fallback &amp; transcript.</text></transcript>',
          ),
    );

    const document = await extractYoutubeTranscript(canonicalUrl, {
      fetchTranscript: fetchTranscriptMock,
      fetch: fetchMock,
      now: () => new Date("2026-09-06T12:00:00.000Z"),
    });

    expect(document).toMatchObject({
      title: "Fallback video",
      author: "Fallback channel",
      filename: "fallback-video.md",
      wordCount: 3,
    });
    expect(document.markdown).toContain("Fallback & transcript.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      canonicalUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      fallbackTrackUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ["YoutubeTranscriptVideoUnavailableError", "video_unavailable"],
    ["YoutubeTranscriptDisabledError", "transcript_unavailable"],
    ["YoutubeTranscriptNotAvailableError", "transcript_unavailable"],
    ["YoutubeTranscriptTooManyRequestError", "youtube_rate_limited"],
    ["AbortError", "transcript_timeout"],
    ["UnknownTranscriptError", "transcript_fetch_failed"],
  ])("maps %s to %s", async (errorName, code) => {
    const NamedError = { [errorName]: class extends Error {} }[errorName];
    await expect(
      extractYoutubeTranscript(canonicalUrl, {
        fetchTranscript: async () => {
          throw new NamedError();
        },
      }),
    ).rejects.toMatchObject({ code } satisfies Partial<ExtractionFailure>);
  });
});

describe("transcript route", () => {
  const document: ExtractedDocument = {
    title: "Example",
    author: "Channel",
    source: "YouTube",
    published: "",
    canonicalUrl,
    markdown: "# Example",
    filename: "example.md",
    wordCount: 1,
    status: { kind: "complete" },
  };

  function buildApp() {
    const app = Fastify();
    registerTranscriptRoute(app, { extract: async () => document });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ExtractionFailure) {
        const response: ExtractionApiResponse = {
          kind: "error",
          code: error.code,
          message: error.message,
        };
        return reply.code(error.statusCode).send(response);
      }
      return reply.code(500).send(error);
    });
    return app;
  }

  it("returns a transcript document", async () => {
    const response = await buildApp().inject({
      method: "POST",
      url: "/api/transcript",
      payload: { url: canonicalUrl },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: "success", document });
  });

  it("rejects a missing URL", async () => {
    const response = await buildApp().inject({
      method: "POST",
      url: "/api/transcript",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ kind: "error", code: "invalid_request" });
  });
});
