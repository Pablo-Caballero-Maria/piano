/**
 * What the server's answers look like (pianocore/api.py, through Vercel or the teacher's PC),
 * checked with zod before the page uses them: a broken or unexpected answer becomes a clear error
 * instead of a crash somewhere else. The types of services/api.ts are inferred from here.
 */
import type { MelodySummary } from "@/lib/melody";
import { z } from "@/lib/zod";

export const roleSchema = z.enum(["teacher", "student"]);

export const userSchema = z.object({ username: z.string().min(1), role: roleSchema });

/** The login session kept in this browser. */
export const sessionSchema = z.object({ token: z.string().min(1), user: userSchema });

export const serverConfigSchema = z.object({
  mode: z.enum(["classroom", "online", "offline"]),
  realtime: z.enum(["ws", "ably"]).nullable(),
});

export const meSchema = z.object({ user: userSchema, notice: z.string().optional() });

export const pcStatusSchema = z.object({
  board: z.object({ online: z.boolean(), version: z.string().optional() }),
  internet: z.boolean(),
  sync: z.object({ result: z.string() }).nullable(),
  update: z.object({ version: z.string(), result: z.string().optional() }),
});

/** Times are milliseconds since 1970 (pianocore/models.py). */
const time = z.number().int().nonnegative();

export const melodySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  bpm: z.number(),
  length: z.number(),
  noteCount: z.number().int().nonnegative(),
  public: z.boolean(),
  owner: z.string(),
  editedBy: z.string().optional(),
  createdAt: time.optional(),
  updatedAt: time,
}) satisfies z.ZodType<MelodySummary>;

export const melodiesSchema = z.object({ melodies: z.array(melodySummarySchema) });

export const savedMelodySchema = z.object({ melody: melodySummarySchema });

/** One melody, with its notes still encoded (lib/melody.ts decodes them). */
export const melodySchema = z.object({
  melody: z.object({
    id: z.string(),
    name: z.string(),
    bpm: z.number(),
    notes: z.string(),
    public: z.boolean(),
    owner: z.string(),
    editedBy: z.string().optional(),
    updatedAt: time.optional(),
  }),
});

export const liveSchema = z.object({ teachers: z.array(z.string()) });

/** For calls whose answer the page doesn't read. */
export const anything = z.unknown();
