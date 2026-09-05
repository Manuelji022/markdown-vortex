import type { FastifyInstance } from "fastify";
import type { ExtractedDocument, ExtractionApiResponse } from "../shared/contracts.js";
import { ExtractionFailure } from "./errors.js";

type TranscriptRouteOptions = {
  extract: (url: string) => Promise<ExtractedDocument>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUrl(body: unknown): string {
  if (!isRecord(body) || typeof body.url !== "string" || body.url.trim() === "") {
    throw new ExtractionFailure({
      code: "invalid_request",
      message: "Provide a YouTube video URL.",
      statusCode: 400,
    });
  }

  return body.url.trim();
}

export function registerTranscriptRoute(
  app: FastifyInstance,
  options: TranscriptRouteOptions,
): void {
  app.post("/api/transcript", async (request, reply) => {
    const document = await options.extract(parseUrl(request.body));
    const response: ExtractionApiResponse = { kind: "success", document };
    return reply.send(response);
  });
}
