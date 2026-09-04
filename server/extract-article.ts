import { Defuddle } from "defuddle/node";
import type { ExtractedDocument, ExtractionStatus } from "../shared/contracts.js";
import { ExtractionFailure } from "./errors.js";
import { fetchHtml } from "./fetch-html.js";

const PAYWALL_PATTERNS = [
  /this post is for paid subscribers/i,
  /subscribe to continue reading/i,
  /already a paid subscriber/i,
  /sign in to continue reading/i,
];

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

  return slug || "article";
}

function detectStatus(html: string): ExtractionStatus {
  return PAYWALL_PATTERNS.some((pattern) => pattern.test(html))
    ? { kind: "partial", reason: "paywall" }
    : { kind: "complete" };
}

type MarkdownOptions = {
  title: string;
  author: string;
  source: string;
  published: string;
  canonicalUrl: string;
  body: string;
  status: ExtractionStatus;
};

export function buildMarkdown(options: MarkdownOptions): string {
  const lines = [
    "---",
    `title: ${yamlValue(options.title)}`,
    "tags: []",
    `source: ${yamlValue(options.canonicalUrl)}`,
  ];

  if (options.author) lines.push(`author: ${yamlValue(options.author)}`);
  if (options.published) lines.push(`published: ${yamlValue(options.published)}`);
  if (options.source) lines.push(`site: ${yamlValue(options.source)}`);
  lines.push(`saved: ${yamlValue(new Date().toISOString())}`);
  lines.push(`status: ${yamlValue(options.status.kind)}`);
  lines.push("---", "", `# ${options.title}`, "");

  if (options.status.kind === "partial") {
    lines.push("> [!warning] Partial capture", "> Paid content was detected. Only accessible HTML was extracted.", "");
  }

  lines.push(options.body.trim(), "");
  return lines.join("\n");
}

type ExtractFetchedHtmlOptions = {
  html: string;
  finalUrl: string;
};

export async function extractFetchedHtml(
  options: ExtractFetchedHtmlOptions,
): Promise<ExtractedDocument> {
  const result = await Defuddle(options.html, options.finalUrl, {
    markdown: true,
    removeImages: false,
    useAsync: false,
  });

  const body = result.content.trim();
  if (body.length < 120) {
    throw new ExtractionFailure({
      code: "extraction_failed",
      message: "The page did not contain enough readable HTML article content.",
      statusCode: 422,
    });
  }

  const canonicalUrl = options.finalUrl;
  const title = result.title.trim() || new URL(canonicalUrl).hostname;
  const status = detectStatus(options.html);
  const markdown = buildMarkdown({
    title,
    author: result.author.trim(),
    source: result.site.trim(),
    published: result.published.trim(),
    canonicalUrl,
    body,
    status,
  });

  return {
    title,
    author: result.author.trim(),
    source: result.site.trim(),
    published: result.published.trim(),
    canonicalUrl,
    markdown,
    filename: `${slugify(title)}.md`,
    wordCount: result.wordCount,
    status,
  };
}

export async function extractArticle(url: string): Promise<ExtractedDocument> {
  return extractFetchedHtml(await fetchHtml(url));
}
