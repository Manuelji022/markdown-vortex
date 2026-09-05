# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. The app is deployed as a Node.js service with Dokploy/Railpack: `pnpm build` emits the client to `dist/client` and the server to `dist/vps/server`, and `pnpm start` runs the production server.

## Product decisions

- The selected visual source is `/Users/manueljimenezlopez/.codex/generated_images/01a06248-65cf-7852-84d8-2bc410cb51e5/exec-26ba787e-0a24-4a32-b320-f316a5471c04.png`.
- Keep the product HTML-only, stateless, and optimized for a small self-hosted VPS.
- Do not add Chromium, Playwright, a database, authentication, history, or direct Obsidian integration.
- The core flow is URL input → server-side HTML extraction → Markdown preview → copy or `.md` download.
- Provide two shareable modes: HTML → Markdown at `/` and YouTube transcript → Markdown at `/youtube`, using a compact header mode switch.
- YouTube mode is captions-only and keyless: accept public video URLs, use the default available caption track, group it into readable paragraphs without timestamps, and do not add audio transcription or proxies.
- Preserve the selected mockup's minimalist monochrome editorial composition, oversized sans-serif headline, restrained navigation, soft neutral atmosphere, fine borders, generous whitespace, and high-contrast black actions.
- Use a clearly public, non-paywalled article for the initial demo state; the first preview should communicate a complete successful capture rather than a partial or restricted result.
- Prefer static semantic HTML and CSS for all visible structure and styling. Keep client JavaScript limited to the extraction request and essential interactive states.
- Use pnpm exclusively for dependency management and project scripts. Do not create or commit an npm lockfile.
