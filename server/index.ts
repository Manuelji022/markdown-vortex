import path from "node:path";
import fastifyStatic from "@fastify/static";
import middie from "@fastify/middie";
import Fastify from "fastify";
import { createServer as createViteServer } from "vite";
import type { ExtractionApiResponse } from "../shared/contracts.js";
import { ExtractionFailure } from "./errors.js";
import { extractArticle } from "./extract-article.js";
import { extractYoutubeTranscript } from "./extract-youtube-transcript.js";
import { registerExtractionRoute } from "./extraction-route.js";
import { registerTranscriptRoute } from "./transcript-route.js";

function readArgument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const host = readArgument("--host", process.env.HOST ?? "127.0.0.1");
const portValue = readArgument("--port", process.env.PORT ?? "4173");
const port = Number(portValue);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid port: ${portValue}`);
}

const root = process.cwd();
const production = process.env.NODE_ENV === "production";
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  bodyLimit: 32 * 1024,
});

app.get("/api/health", async () => ({ status: "ok" }));
registerExtractionRoute(app, { extract: extractArticle });
registerTranscriptRoute(app, { extract: extractYoutubeTranscript });

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ExtractionFailure) {
    const response: ExtractionApiResponse = {
      kind: "error",
      code: error.code,
      message: error.message,
    };
    return reply.code(error.statusCode).send(response);
  }

  app.log.error(error);
  const response: ExtractionApiResponse = {
    kind: "error",
    code: "extraction_failed",
    message: "The page could not be converted to Markdown.",
  };
  return reply.code(500).send(response);
});

if (production) {
  await app.register(fastifyStatic, {
    root: path.join(root, "dist", "client"),
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
      return reply.sendFile("index.html");
    }

    return reply.code(404).send({ error: "Not found" });
  });
} else {
  await app.register(middie);
  const vite = await createViteServer({
    root,
    appType: "spa",
    server: { middlewareMode: true },
  });

  app.use((request, response, next) => {
    if (request.url?.startsWith("/api/")) {
      next();
      return;
    }

    vite.middlewares(request, response, next);
  });

  app.addHook("onClose", async () => vite.close());
}

await app.listen({ host, port });
