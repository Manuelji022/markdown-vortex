import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { ExtractionFailure } from "./errors.js";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "html-to-markdown/0.1 (+https://github.com/self-hosted/html-to-markdown)";

export type FetchedHtml = {
  html: string;
  finalUrl: string;
};

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;

  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

export async function validatePublicUrl(value: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(value);
  } catch (cause) {
    throw new ExtractionFailure({
      code: "invalid_url",
      message: "Enter a valid HTTP or HTTPS URL.",
      statusCode: 400,
      cause,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractionFailure({
      code: "invalid_url",
      message: "Only HTTP and HTTPS URLs are supported.",
      statusCode: 400,
    });
  }

  if (url.username || url.password) {
    throw new ExtractionFailure({
      code: "invalid_url",
      message: "URLs containing credentials are not supported.",
      statusCode: 400,
    });
  }

  const allowedPort =
    url.port === "" ||
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443");

  if (!allowedPort) {
    throw new ExtractionFailure({
      code: "blocked_url",
      message: "Only standard HTTP and HTTPS ports are allowed.",
      statusCode: 400,
    });
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.toLowerCase() === "localhost" || hostname.endsWith(".local")) {
    throw new ExtractionFailure({
      code: "blocked_url",
      message: "Private and local network addresses are not allowed.",
      statusCode: 400,
    });
  }

  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new ExtractionFailure({
        code: "blocked_url",
        message: "Private and local network addresses are not allowed.",
        statusCode: 400,
      });
    }

    return url;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new ExtractionFailure({
      code: "fetch_failed",
      message: "The hostname could not be resolved.",
      statusCode: 502,
      cause,
    });
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ExtractionFailure({
      code: "blocked_url",
      message: "Private and local network addresses are not allowed.",
      statusCode: 400,
    });
  }

  return url;
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) {
    throw new ExtractionFailure({
      code: "fetch_failed",
      message: "The page returned an empty response.",
      statusCode: 502,
    });
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new ExtractionFailure({
      code: "response_too_large",
      message: "The HTML response is larger than 5 MB.",
      statusCode: 413,
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    received += result.value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ExtractionFailure({
        code: "response_too_large",
        message: "The HTML response is larger than 5 MB.",
        statusCode: 413,
      });
    }

    chunks.push(result.value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchHtml(input: string): Promise<FetchedHtml> {
  let currentUrl = await validatePublicUrl(input);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "accept-language": "en-US,en;q=0.8",
          "user-agent": USER_AGENT,
        },
      });
    } catch (cause) {
      throw new ExtractionFailure({
        code: "fetch_failed",
        message: "The page could not be fetched within 15 seconds.",
        statusCode: 502,
        cause,
      });
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new ExtractionFailure({
          code: "fetch_failed",
          message: "The page returned an invalid redirect.",
          statusCode: 502,
        });
      }

      if (redirectCount === MAX_REDIRECTS) {
        throw new ExtractionFailure({
          code: "fetch_failed",
          message: "The page redirected too many times.",
          statusCode: 502,
        });
      }

      currentUrl = await validatePublicUrl(new URL(location, currentUrl).href);
      continue;
    }

    if (!response.ok) {
      throw new ExtractionFailure({
        code: "fetch_failed",
        message: `The page returned HTTP ${response.status}.`,
        statusCode: 502,
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new ExtractionFailure({
        code: "unsupported_content_type",
        message: `This URL returned ${contentType || "an unknown content type"}, not HTML.`,
        statusCode: 415,
      });
    }

    return {
      html: await readBody(response),
      finalUrl: currentUrl.href,
    };
  }

  throw new ExtractionFailure({
    code: "fetch_failed",
    message: "The page could not be fetched.",
    statusCode: 502,
  });
}
