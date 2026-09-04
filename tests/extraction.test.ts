import { describe, expect, it } from "vitest";
import { buildMarkdown, extractFetchedHtml } from "../server/extract-article.js";

const articleHtml = `<!doctype html>
<html lang="en">
  <head>
    <title>Readable systems</title>
    <meta name="author" content="Ada Example" />
    <meta property="og:site_name" content="Example Notes" />
  </head>
  <body>
    <header><nav>Home Archive Subscribe</nav></header>
    <article>
      <h1>Readable systems</h1>
      <p>Good systems make their most important behavior easy to understand.</p>
      <p>This fixture contains enough meaningful prose for the extractor to identify the article and remove surrounding navigation.</p>
      <h2>A useful section</h2>
      <p>Clear boundaries keep the implementation small while preserving the details readers care about.</p>
    </article>
    <footer>Copyright Example Notes</footer>
  </body>
</html>`;

describe("article extraction", () => {
  it("converts readable HTML into a Markdown document", async () => {
    const result = await extractFetchedHtml({
      html: articleHtml,
      finalUrl: "https://example.com/readable-systems",
    });

    expect(result.title).toBe("Readable systems");
    expect(result.status).toEqual({ kind: "complete" });
    expect(result.filename).toBe("readable-systems.md");
    expect(result.markdown).toContain("# Readable systems");
    expect(result.markdown).toContain("tags: []");
    expect(result.markdown).toContain("A useful section");
    expect(result.markdown).not.toContain("Home Archive Subscribe");
  });

  it("marks known paid-content boundaries as partial", async () => {
    const result = await extractFetchedHtml({
      html: articleHtml.replace(
        "</article>",
        "<h2>This post is for paid subscribers</h2></article>",
      ),
      finalUrl: "https://example.com/paid-article",
    });

    expect(result.status).toEqual({ kind: "partial", reason: "paywall" });
    expect(result.markdown).toContain("> [!warning] Partial capture");
  });

  it("escapes frontmatter values and keeps remote images", () => {
    const markdown = buildMarkdown({
      title: "A title: with punctuation",
      author: "Example Author",
      source: "Example",
      published: "2026-09-02",
      canonicalUrl: "https://example.com/article",
      body: "![Diagram](https://example.com/diagram.png)",
      status: { kind: "complete" },
    });

    expect(markdown).toContain('title: "A title: with punctuation"');
    expect(markdown).toContain("tags: []");
    expect(markdown).toContain("![Diagram](https://example.com/diagram.png)");
  });
});
