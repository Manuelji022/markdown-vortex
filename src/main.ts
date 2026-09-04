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

/* Static page structure lives in index.html so it renders without client JavaScript.
const app = document.getElementById("app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <div class="site-shell">
    <header class="site-header" aria-label="Primary navigation">
      <a class="wordmark" href="#extract" aria-label="HTML to Markdown home">
        <i class="ph-fill ph-triangle" aria-hidden="true"></i>
        <span>html <span aria-hidden="true">→</span> md</span>
      </a>
      <nav class="site-nav" aria-label="Information">
        <button class="nav-link" type="button" data-dialog-section="how">How it works</button>
        <button class="nav-link" type="button" data-dialog-section="privacy">Privacy</button>
        <button class="nav-link" type="button" data-dialog-section="about">About</button>
      </nav>
    </header>

    <main id="extract" class="hero">
      <section class="input-column" aria-labelledby="page-title">
        <div class="hero-copy">
          <h1 id="page-title">Paste a link.<br />Keep the article.</h1>
          <p class="hero-description">Turn readable HTML into clean Markdown for Obsidian.</p>
        </div>

        <form id="extract-form" class="extract-form" novalidate>
          <label for="article-url">Article URL</label>
          <div class="url-control">
            <input
              id="article-url"
              name="url"
              type="url"
              value="${SAMPLE_URL}"
              placeholder="https://example.com/article"
              inputmode="url"
              autocomplete="url"
              spellcheck="false"
              required
            />
            <button id="extract-button" class="primary-action" type="submit">
              <span>Extract Markdown</span>
            </button>
          </div>
          <p id="form-message" class="form-message" role="status" aria-live="polite"></p>
        </form>
      </section>

      <section class="preview-shell" aria-labelledby="preview-title">
        <div class="preview-card">
          <div class="preview-toolbar">
            <h2 id="preview-title">Markdown preview</h2>
            <div class="preview-actions">
              <button id="copy-button" class="icon-action" type="button" aria-label="Copy Markdown">
                <i class="ph ph-copy" aria-hidden="true"></i>
              </button>
              <button id="download-button" class="icon-action" type="button" aria-label="Download Markdown file">
                <i class="ph ph-download-simple" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div id="capture-status" class="capture-status" data-status="partial">
            Partial · paywall detected
          </div>
          <pre id="markdown-preview" class="markdown-preview" tabindex="0"><code id="markdown-output"></code></pre>
        </div>
      </section>
    </main>

    <dialog id="info-dialog" class="info-dialog">
      <div class="dialog-header">
        <p id="dialog-label" class="detail-label"></p>
        <button id="dialog-close" class="dialog-close" type="button">Close</button>
      </div>
      <h2 id="dialog-title"></h2>
      <p id="dialog-copy"></p>
    </dialog>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>
`;
*/

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
const urlInput = requireInput("article-url");
const submitButton = requireButton("extract-button");
const formMessage = requireElement("form-message");
const markdownOutput = requireElement("markdown-output");
const captureStatus = requireElement("capture-status");
const copyButton = requireButton("copy-button");
const downloadButton = requireButton("download-button");
const toast = requireElement("toast");
const dialog = requireDialog("info-dialog");
const dialogLabel = requireElement("dialog-label");
const dialogTitle = requireElement("dialog-title");
const dialogCopy = requireElement("dialog-copy");
const dialogClose = requireButton("dialog-close");

let currentDocument: ExtractedDocument = sampleDocument;
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

function setLoading(loading: boolean): void {
  submitButton.disabled = loading;
  urlInput.disabled = loading;
  submitButton.classList.toggle("is-loading", loading);
  submitButton.querySelector("span")?.replaceChildren(
    loading ? "Extracting…" : "Extract Markdown",
  );
  if (loading) {
    captureStatus.dataset.status = "loading";
    captureStatus.textContent = "Fetching HTML…";
    markdownOutput.textContent = "Reading the page and cleaning its article content…";
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
  await navigator.clipboard.writeText(currentDocument.markdown);
  showToast("Markdown copied");
}

function downloadMarkdown(): void {
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
  activeRequest = new AbortController();
  setLoading(true);

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: urlInput.value }),
      signal: activeRequest.signal,
    });
    const payload: unknown = await response.json();
    const parsed = parseApiResponse(payload);

    if (!parsed) throw new Error("The server returned an unexpected response.");
    if (parsed.kind === "error") {
      formMessage.textContent = parsed.message;
      renderDocument(currentDocument);
      return;
    }

    renderDocument(parsed.document);
    showToast("Markdown ready");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    formMessage.textContent =
      error instanceof Error ? error.message : "The page could not be extracted.";
    renderDocument(currentDocument);
  } finally {
    setLoading(false);
    activeRequest = null;
  }
});

copyButton.addEventListener("click", () => {
  void copyMarkdown().catch(() => {
    formMessage.textContent = "Clipboard access was blocked. Select the preview and copy it manually.";
  });
});
downloadButton.addEventListener("click", downloadMarkdown);

const dialogContent = {
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

renderDocument(sampleDocument);
