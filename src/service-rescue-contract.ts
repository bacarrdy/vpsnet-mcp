import { z } from "zod";

export const serviceRescueImageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  .describe("Exact opaque rescue image ID returned by get_service_rescue");

const serviceRescueImageSchema = z.object({
  id: serviceRescueImageIdSchema,
  family: z.enum(["linux", "iso"]),
  console: z.enum(["serial", "novnc"]),
  mountPath: z.string().max(128).optional(),
  device: z.string().max(128).optional(),
}).strict();

const serviceRescueCapabilitySchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  platform: z.string().min(1).max(16),
  images: z.array(serviceRescueImageSchema).max(8),
}).strict();

export const serviceRescueSessionSchema = z.object({
  id: z.string().uuid(),
  platform: z.enum(["firecracker", "vds"]),
  image: serviceRescueImageIdSchema,
  state: z.enum([
    "queued",
    "processing",
    "awaiting_reply",
    "active",
    "needs_attention",
    "failed",
    "completed",
  ]),
  active: z.boolean(),
  desiredState: z.enum(["active", "inactive"]),
  operation: z.enum(["enter", "exit"]),
  progressPercent: z.number().int().min(0).max(100),
  progressStage: z.string().min(1).max(64),
  originalRunning: z.boolean().nullable(),
  errorCode: z.string().max(96).nullable(),
  activatedAt: z.string().max(32).nullable(),
  completedAt: z.string().max(32).nullable(),
  createdAt: z.string().min(1).max(32),
  updatedAt: z.string().min(1).max(32),
}).strict();

const serviceRescueStatusResponseSchema = z.object({
  success: z.literal(true),
  rescue: z.object({
    capability: serviceRescueCapabilitySchema,
    session: serviceRescueSessionSchema.nullable(),
  }).strict(),
}).strict();

const serviceRescueMutationResponseSchema = z.object({
  success: z.literal(true),
  replayed: z.boolean(),
  retried: z.boolean(),
  session: serviceRescueSessionSchema,
}).strict();

export type ServiceRescueStatusResponse = z.infer<
  typeof serviceRescueStatusResponseSchema
>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorCodes(value: unknown): string[] {
  return Object.entries(record(value))
    .filter(([key, enabled]) =>
      enabled === true
      && !["success", "replayed", "retried"].includes(key)
      && /^[A-Za-z][A-Za-z0-9._-]{0,95}$/.test(key)
    )
    .slice(0, 20)
    .map(([key]) => key);
}

export function parseServiceRescueStatus(
  data: unknown
): ServiceRescueStatusResponse | null {
  const parsed = serviceRescueStatusResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function safeServiceRescuePayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const statusPayload = serviceRescueStatusResponseSchema.safeParse(data);
  if (statusPayload.success) {
    return statusPayload.data;
  }

  const mutationPayload = serviceRescueMutationResponseSchema.safeParse(data);
  if (mutationPayload.success) {
    return mutationPayload.data;
  }

  return {
    success: false,
    http_status: status,
    error_codes: errorCodes(data),
  };
}

export function serviceRescueEnterRequestBody(
  image: string
): Record<string, unknown> {
  return {
    image,
    acknowledgeReboot: true,
  };
}
