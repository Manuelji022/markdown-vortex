# html → md

A small, stateless web app that fetches server-rendered HTML, isolates the readable article, and returns Markdown ready to copy into Obsidian.

## Stack

- Node.js 24 and TypeScript
- Fastify for the HTTP server
- Defuddle with LinkeDOM for HTML extraction
- Static semantic HTML and CSS for the interface
- A small vanilla TypeScript module for the form, preview, copy, and download actions
- pnpm for dependency management and scripts

The application does not use Chromium, Playwright, a database, authentication, history, or direct Obsidian integration.

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
pnpm test:sites
```

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
