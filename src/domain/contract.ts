import { z } from "zod";

import {
  MAX_DIAGNOSTIC_CODE_CHARACTERS,
  MAX_DIAGNOSTIC_MESSAGE_CHARACTERS,
  MAX_DIAGNOSTIC_PATH_CHARACTERS,
  MAX_RESULT_DIAGNOSTICS_RETURNED,
} from "./bounds.js";

export { SERVER_VERSION } from "../identity.js";

export const CONTRACT_VERSION = "electronics.mcp/0.2" as const;

export const DiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().max(MAX_DIAGNOSTIC_CODE_CHARACTERS),
  path: z.string().max(MAX_DIAGNOSTIC_PATH_CHARACTERS),
  message: z.string().max(MAX_DIAGNOSTIC_MESSAGE_CHARACTERS),
}).strict();

export const ContractContextSchema = z.object({
  serverInstanceId: z.string(),
  sessionScope: z.literal("process"),
  backendId: z.string().optional(),
  adapterVersion: z.string().optional(),
  compatibilityProfile: z.string().optional(),
  projectRef: z.string().optional(),
  projectDigest: z.string().optional(),
}).strict();

export const NextActionSchema = z.object({
  tool: z.string(),
  reason: z.string(),
  arguments: z.record(z.string(), z.json()),
}).strict();

export const ToolErrorSchema = z.object({
  code: z.enum([
    "INVALID_ARGUMENT",
    "UNSUPPORTED_SCHEMA",
    "PATH_DENIED",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "UNSUPPORTED_FORMAT",
    "FORMAT_INVALID",
    "PROJECT_INVALID",
    "PROJECT_STATE_CONFLICT",
    "UNSUPPORTED_OPERATION",
    "UNSUPPORTED_COMPONENT",
    "LOSSY_CONVERSION_FORBIDDEN",
    "BACKEND_UNAVAILABLE",
    "AUTH_REQUIRED",
    "SESSION_NOT_FOUND",
    "SESSION_STATE_CONFLICT",
    "TIMEOUT",
    "QUOTA_EXCEEDED",
    "CANCELLED",
    "INTERNAL_ERROR",
  ]),
  category: z.enum([
    "argument",
    "filesystem",
    "format",
    "project",
    "backend",
    "session",
    "auth",
    "internal",
  ]),
  message: z.string(),
  retryable: z.boolean(),
  argumentPath: z.string().optional(),
  recovery: z.array(z.string()),
}).strict();

export function envelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    contractVersion: z.literal(CONTRACT_VERSION),
    ok: z.boolean(),
    summary: z.string(),
    data: dataSchema.optional(),
    diagnostics: z
      .array(DiagnosticSchema)
      .max(MAX_RESULT_DIAGNOSTICS_RETURNED),
    context: ContractContextSchema,
    nextActions: z.array(NextActionSchema),
    error: ToolErrorSchema.optional(),
  }).strict();
}

export type ToolError = z.infer<typeof ToolErrorSchema>;
export type ContractContext = z.infer<typeof ContractContextSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;

export interface ContractEnvelope<T> {
  contractVersion: typeof CONTRACT_VERSION;
  ok: boolean;
  summary: string;
  data?: T;
  diagnostics: z.infer<typeof DiagnosticSchema>[];
  context: ContractContext;
  nextActions: NextAction[];
  error?: ToolError;
}
