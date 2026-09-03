import type { FastifyInstance } from "fastify";
import type { ExtractedDocument, ExtractionApiResponse } from "../shared/contracts.js";
import { ExtractionFailure } from "./errors.js";

type ExtractionRouteOptions = {
  extract: (url: string) => Promise<ExtractedDocument>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUrl(body: unknown): string {
  if (!isRecord(body) || typeof body.url !== "string" || body.url.trim() === "") {
    throw new ExtractionFailure({
      code: "invalid_request",
      message: "Provide a URL to extract.",
      statusCode: 400,
    });
  }

  return body.url.trim();
}

export function registerExtractionRoute(
  app: FastifyInstance,
  options: ExtractionRouteOptions,
): void {
  app.post("/api/extract", async (request, reply) => {
    const document = await options.extract(parseUrl(request.body));
    const response: ExtractionApiResponse = { kind: "success", document };
    return reply.send(response);
  });
}
