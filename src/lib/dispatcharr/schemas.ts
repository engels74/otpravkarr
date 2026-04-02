import { z } from "zod";

export const DispatcharrUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().optional(),
  is_staff: z.boolean(),
  is_active: z.boolean(),
  groups: z.array(z.number()),
});

export const DispatcharrGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  permissions: z.array(z.number()),
});

export const DispatcharrChannelProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const DispatcharrChannelSchema = z.object({
  id: z.number(),
  name: z.string(),
  number: z.number(),
  enabled: z.boolean(),
});

/** Minimal schema for health-probe responses (paginated endpoint, items ignored). */
export const HealthProbeSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(z.unknown()),
});

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
