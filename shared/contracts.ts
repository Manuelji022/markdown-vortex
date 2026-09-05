export type ExtractionStatus =
  | { kind: "complete" }
  | { kind: "partial"; reason: "paywall" };

export type ExtractedDocument = {
  title: string;
  author: string;
  source: string;
  published: string;
  canonicalUrl: string;
  markdown: string;
  filename: string;
  wordCount: number;
  status: ExtractionStatus;
};

export type ExtractionErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "blocked_url"
  | "unsupported_content_type"
  | "response_too_large"
  | "fetch_failed"
  | "extraction_failed"
  | "invalid_youtube_url"
  | "video_unavailable"
  | "transcript_unavailable"
  | "youtube_rate_limited"
  | "transcript_timeout"
  | "transcript_fetch_failed";

export type ExtractionApiResponse =
  | { kind: "success"; document: ExtractedDocument }
  | { kind: "error"; code: ExtractionErrorCode; message: string };
