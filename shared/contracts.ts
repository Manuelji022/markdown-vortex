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
  | "extraction_failed";

export type ExtractionApiResponse =
  | { kind: "success"; document: ExtractedDocument }
  | { kind: "error"; code: ExtractionErrorCode; message: string };
