import type {
  ExtractedDocument,
  ExtractionApiResponse,
  ExtractionErrorCode,
  ExtractionStatus,
} from "../shared/contracts";
import "./styles.css";

const SAMPLE_URL =
  "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Basic_HTML_syntax";

const sampleDocument = {
  title: "Basic HTML syntax",
  author: "MDN contributors",
  source: "MDN Web Docs",
  published: "n.d.",
  canonicalUrl: SAMPLE_URL,
  filename: "basic-html-syntax.md",
  wordCount: 176,
  status: { kind: "complete" },
  markdown: `---
title: "Basic HTML syntax"
author: "MDN contributors"
tags: []
source: "${SAMPLE_URL}"
site: "MDN Web Docs"
published: "n.d."
status: "complete"
---

# Basic HTML syntax

HTML uses elements to describe the structure and meaning of a page. Elements are written with tags, which tell the browser where a piece of content begins and ends.

## Anatomy of an HTML element

Most elements have an opening tag, content, and a closing tag:

\`\`\`html
<p>My first paragraph.</p>
\`\`\`

The opening tag names the element, and the closing tag includes a slash before the name. Together they mark the paragraph as a distinct block of text.

## Nesting elements

Elements can contain other elements. This nesting creates the document structure that browsers and assistive technologies use:

\`\`\`html
<p>My cat is <strong>very</strong> grumpy.</p>
\`\`\`

Keep opening and closing tags correctly nested so the structure remains predictable.

## What Markdown keeps

- Headings and paragraphs
- Lists, links, and code examples
- Source metadata for your Obsidian note
`,
} satisfies ExtractedDocument;

type ConversionMode = "article" | "youtube";

type ModeConfiguration = {
  mode: ConversionMode;
  endpoint: string;
  title: string;
  description: string;
  headingHtml: string;
  lede: string;
  inputLabel: string;
  placeholder: string;
  initialValue: string;
  submitLabel: string;
  loadingLabel: string;
  loadingStatus: string;
  loadingPreview: string;
  emptyStatus: string;
  emptyPreview: string;
  initialDocument: ExtractedDocument | null;
};

const isYoutubePath = window.location.pathname.replace(/\/+$/, "") === "/youtube";
const youtubeEnabled = __YOUTUBE_ENABLED__;

const articleMode: ModeConfiguration = {
  mode: "article",
  endpoint: "/api/extract",
  title: "HTML → Markdown",
  description: "Extract readable HTML articles as clean Markdown.",
  headingHtml: "Paste a link.<br />Keep the article.",
  lede: "Turn readable HTML into clean Markdown.",
  inputLabel: "Article URL",
  placeholder: SAMPLE_URL,
  initialValue: "",
  submitLabel: "Extract Markdown",
  loadingLabel: "Extracting…",
  loadingStatus: "Fetching HTML…",
  loadingPreview: "Reading the page and cleaning its article content…",
  emptyStatus: "Ready for an article link",
  emptyPreview: "Paste an article URL to create a clean Markdown note.",
  initialDocument: sampleDocument,
};

const youtubeMode: ModeConfiguration = {
  mode: "youtube",
  endpoint: "/api/transcript",
  title: "YouTube transcript → Markdown",
  description: "Turn public YouTube captions into readable Markdown.",
  headingHtml: "Paste a video.<br />Keep the transcript.",
  lede: "Turn YouTube captions into clean Markdown.",
  inputLabel: "YouTube video URL",
  placeholder: "https://youtube.com/watch?v=…",
  initialValue: "",
  submitLabel: "Extract Transcript",
  loadingLabel: "Extracting…",
  loadingStatus: "Fetching captions…",
  loadingPreview: "Reading the available captions and shaping them into paragraphs…",
  emptyStatus: "Ready for a YouTube link",
  emptyPreview:
    "Paste a public YouTube video with captions. Its transcript will appear here as readable Markdown.",
  initialDocument: null,
};

const mode = youtubeEnabled && isYoutubePath
  ? youtubeMode
  : articleMode;

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button: ${id}`);
  return element;
}

function requireInput(id: string): HTMLInputElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input: ${id}`);
  return element;
}

function requireForm(id: string): HTMLFormElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLFormElement)) throw new Error(`Expected form: ${id}`);
  return element;
}

function requireDialog(id: string): HTMLDialogElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLDialogElement)) throw new Error(`Expected dialog: ${id}`);
  return element;
}

const form = requireForm("extract-form");
const urlInput = requireInput("source-url");
const submitButton = requireButton("extract-button");
const formMessage = requireElement("form-message");
const pageTitle = requireElement("page-title");
const heroDescription = requireElement("hero-description");
const urlLabel = requireElement("url-label");
const youtubeModeLink = document.querySelector<HTMLAnchorElement>(
  '[data-conversion-mode="youtube"]',
);
const markdownOutput = requireElement("markdown-output");
const markdownPreview = requireElement("markdown-preview");
const captureStatus = requireElement("capture-status");
const copyButton = requireButton("copy-button");
const downloadButton = requireButton("download-button");
const toast = requireElement("toast");
const dialog = requireDialog("info-dialog");
const dialogLabel = requireElement("dialog-label");
const dialogTitle = requireElement("dialog-title");
const dialogCopy = requireElement("dialog-copy");
const dialogClose = requireButton("dialog-close");

let currentDocument: ExtractedDocument | null = mode.initialDocument;
let activeRequest: AbortController | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStatus(value: unknown): ExtractionStatus | null {
  if (!isRecord(value)) return null;
  if (value.kind === "complete") return { kind: "complete" };
  if (value.kind === "partial" && value.reason === "paywall") {
    return { kind: "partial", reason: "paywall" };
  }
  return null;
}

function parseDocument(value: unknown): ExtractedDocument | null {
  if (!isRecord(value)) return null;
  const status = parseStatus(value.status);
  if (
    typeof value.title !== "string" ||
    typeof value.author !== "string" ||
    typeof value.source !== "string" ||
    typeof value.published !== "string" ||
    typeof value.canonicalUrl !== "string" ||
    typeof value.markdown !== "string" ||
    typeof value.filename !== "string" ||
    typeof value.wordCount !== "number" ||
    !status
  ) {
    return null;
  }

  return {
    title: value.title,
    author: value.author,
    source: value.source,
    published: value.published,
    canonicalUrl: value.canonicalUrl,
    markdown: value.markdown,
    filename: value.filename,
    wordCount: value.wordCount,
    status,
  };
}

function parseErrorCode(value: unknown): ExtractionErrorCode | null {
  switch (value) {
    case "invalid_request":
    case "invalid_url":
    case "blocked_url":
    case "unsupported_content_type":
    case "response_too_large":
    case "fetch_failed":
    case "extraction_failed":
    case "invalid_youtube_url":
    case "video_unavailable":
    case "transcript_unavailable":
    case "youtube_rate_limited":
    case "transcript_timeout":
    case "transcript_fetch_failed":
      return value;
    default:
      return null;
  }
}

function parseApiResponse(value: unknown): ExtractionApiResponse | null {
  if (!isRecord(value)) return null;

  if (value.kind === "success") {
    const documentValue = parseDocument(value.document);
    return documentValue ? { kind: "success", document: documentValue } : null;
  }

  if (value.kind === "error" && typeof value.message === "string") {
    const code = parseErrorCode(value.code);
    return code ? { kind: "error", code, message: value.message } : null;
  }

  return null;
}

function renderDocument(documentValue: ExtractedDocument): void {
  currentDocument = documentValue;
  markdownPreview.classList.remove("is-empty");
  markdownOutput.textContent = documentValue.markdown;
  captureStatus.dataset.status = documentValue.status.kind;
  captureStatus.textContent =
    documentValue.status.kind === "partial"
      ? "Partial · paywall detected"
      : documentValue.wordCount > 0
        ? `Complete · ${documentValue.wordCount.toLocaleString()} words`
        : "Complete";
  copyButton.disabled = false;
  downloadButton.disabled = false;
}

function renderEmptyState(): void {
  currentDocument = null;
  markdownPreview.classList.add("is-empty");
  markdownOutput.textContent = mode.emptyPreview;
  captureStatus.dataset.status = "empty";
  captureStatus.textContent = mode.emptyStatus;
  copyButton.disabled = true;
  downloadButton.disabled = true;
}

function restorePreview(): void {
  if (currentDocument) {
    renderDocument(currentDocument);
  } else {
    renderEmptyState();
  }
}

function setLoading(loading: boolean): void {
  submitButton.disabled = loading;
  urlInput.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  submitButton.querySelector("span")?.replaceChildren(
    loading ? mode.loadingLabel : mode.submitLabel,
  );
  if (loading) {
    captureStatus.dataset.status = "loading";
    captureStatus.textContent = mode.loadingStatus;
    markdownPreview.classList.add("is-empty");
    markdownOutput.textContent = mode.loadingPreview;
    copyButton.disabled = true;
    downloadButton.disabled = true;
  }
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2_200);
}

async function copyMarkdown(): Promise<void> {
  if (!currentDocument) return;
  await navigator.clipboard.writeText(currentDocument.markdown);
  showToast("Markdown copied");
}

function downloadMarkdown(): void {
  if (!currentDocument) return;
  const blob = new Blob([currentDocument.markdown], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = currentDocument.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  showToast("Markdown downloaded");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";

  if (!urlInput.checkValidity()) {
    formMessage.textContent = "Enter a complete HTTP or HTTPS URL.";
    urlInput.focus();
    return;
  }

  activeRequest?.abort();
  const requestController = new AbortController();
  activeRequest = requestController;
  setLoading(true);

  try {
    const response = await fetch(mode.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: urlInput.value }),
      signal: requestController.signal,
    });
    const payload: unknown = await response.json();
    const parsed = parseApiResponse(payload);

    if (!parsed) throw new Error("The server returned an unexpected response.");
    if (parsed.kind === "error") {
      formMessage.textContent = parsed.message;
      restorePreview();
      return;
    }

    renderDocument(parsed.document);
    showToast("Markdown ready");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    formMessage.textContent =
      error instanceof Error ? error.message : "The content could not be extracted.";
    restorePreview();
  } finally {
    if (activeRequest === requestController) {
      setLoading(false);
      activeRequest = null;
    }
  }
});

copyButton.addEventListener("click", () => {
  void copyMarkdown().catch(() => {
    formMessage.textContent = "Clipboard access was blocked. Select the preview and copy it manually.";
  });
});
downloadButton.addEventListener("click", downloadMarkdown);

const articleDialogContent = {
  about: {
    label: "About",
    title: "Keep the readable page, lose the clutter.",
    copy: "This small self-hosted tool fetches server-rendered HTML and converts its main article content into Markdown.",
  },
  how: {
    label: "How it works",
    title: "Fetch. Clean. Convert.",
    copy: "The server validates the URL, downloads HTML, isolates the readable article, and returns Markdown without opening a browser.",
  },
  privacy: {
    label: "Privacy",
    title: "Stateless by design.",
    copy: "URLs and extracted articles are processed in memory. The application does not keep a history or write content to a database.",
  },
} satisfies Record<string, { label: string; title: string; copy: string }>;

const youtubeDialogContent = {
  about: {
    label: "About",
    title: "Keep the words, lose the player.",
    copy: "This small self-hosted tool turns the available captions from a public YouTube video into readable Markdown.",
  },
  how: {
    label: "How it works",
    title: "Fetch. Group. Convert.",
    copy: "The server validates the YouTube link, retrieves its default caption track, groups the transcript into readable paragraphs, and returns Markdown.",
  },
  privacy: {
    label: "Privacy",
    title: "Stateless by design.",
    copy: "Video URLs and transcripts are processed in memory and sent only to YouTube for caption retrieval. The application keeps no history or database.",
  },
} satisfies Record<string, { label: string; title: string; copy: string }>;

const dialogContent = mode.mode === "youtube" ? youtubeDialogContent : articleDialogContent;

function getDialogContent(key: string | undefined):
  | { label: string; title: string; copy: string }
  | undefined {
  switch (key) {
    case "about":
      return dialogContent.about;
    case "how":
      return dialogContent.how;
    case "privacy":
      return dialogContent.privacy;
    default:
      return undefined;
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-dialog-section]").forEach((button) => {
  button.addEventListener("click", () => {
    const content = getDialogContent(button.dataset.dialogSection);
    if (!content) return;
    dialogLabel.textContent = content.label;
    dialogTitle.textContent = content.title;
    dialogCopy.textContent = content.copy;
    dialog.showModal();
  });
});

dialogClose.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

function applyMode(): void {
  if (youtubeModeLink) youtubeModeLink.hidden = !youtubeEnabled;
  if (!youtubeEnabled && isYoutubePath) {
    window.history.replaceState(null, "", "/");
  }

  document.title = mode.title;
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute("content", mode.description);
  document.body.dataset.mode = mode.mode;
  pageTitle.innerHTML = mode.headingHtml;
  heroDescription.textContent = mode.lede;
  urlLabel.textContent = mode.inputLabel;
  urlInput.value = mode.initialValue;
  urlInput.placeholder = mode.placeholder;
  submitButton.querySelector("span")?.replaceChildren(mode.submitLabel);

  document.querySelectorAll<HTMLAnchorElement>("[data-conversion-mode]").forEach((link) => {
    const active = link.dataset.conversionMode === mode.mode;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

applyMode();
if (mode.initialDocument) renderDocument(mode.initialDocument);
else renderEmptyState();
