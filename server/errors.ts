import type { ExtractionErrorCode } from "../shared/contracts.js";

type ExtractionFailureOptions = {
  code: ExtractionErrorCode;
  message: string;
  statusCode: number;
  cause?: unknown;
};

export class ExtractionFailure extends Error {
  readonly code: ExtractionErrorCode;
  readonly statusCode: number;

  constructor(options: ExtractionFailureOptions) {
    super(options.message, { cause: options.cause });
    this.name = "ExtractionFailure";
    this.code = options.code;
    this.statusCode = options.statusCode;
  }
}
