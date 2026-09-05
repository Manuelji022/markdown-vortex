# Markdown converters

A small, stateless web app with two focused tools:

- HTML → Markdown fetches server-rendered HTML and isolates the readable article.
- YouTube → Markdown retrieves a public video's available captions and groups them into readable paragraphs.

Both modes return Markdown ready to preview, copy, or download for Obsidian.

## Stack

- Node.js 24 and TypeScript
- Fastify for the HTTP server
- Defuddle with LinkeDOM for HTML extraction
- `youtube-transcript-plus` for public YouTube caption retrieval
- Static semantic HTML and CSS for the interface
- A small vanilla TypeScript module for the form, preview, copy, and download actions
- pnpm for dependency management and scripts

The application does not use Chromium, Playwright, a database, authentication, history, audio transcription, or direct Obsidian integration.

## Local development

```bash
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:4173`.

## Verification

```bash
pnpm check
pnpm test
pnpm build
```

## Dokploy with Railpack

Select the Railpack build type for the application. The existing package scripts are sufficient:

- Build command: `pnpm build`
- Start command: `pnpm start`
- Application port: `4173`

No additional Railpack configuration is required.

## Production

Build and run directly:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Or build the included container:

```bash
docker build -t html-to-md .
docker run --rm -p 4173:4173 html-to-md
```

Place a TLS reverse proxy such as Caddy in front of port `4173` on the VPS.

## Runtime limits

- HTTP and HTTPS URLs only
- Standard ports only
- Local, private, loopback, and reserved network addresses are blocked
- Redirect targets are revalidated
- HTML responses only
- 15-second fetch timeout
- 5 MB response limit
- 5 redirects maximum

Extraction happens in memory and is not persisted.

## YouTube transcript limits

- Public YouTube video URLs only; channels and playlists are rejected
- Existing manual or automatically generated captions only
- The video's default caption track is used
- No YouTube API key, account, audio download, or speech-to-text fallback
- YouTube may rate-limit requests from a self-hosted VPS
