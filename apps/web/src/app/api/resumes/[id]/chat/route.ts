import type { StudioEvent } from "@gettargetrole/ai";
import { ValidationError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { enforceRateLimit } from "@gettargetrole/core/rate-limit";
import { companies, getDb, jobs } from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { aiFor } from "@/server/ai";
import { candidateProfile } from "@/server/data/profile";
import {
  appendMessages,
  getResume,
  oldestFirstMessages,
  saveResumeContent,
} from "@/server/data/resumes";
import { errorResponse, forbiddenOrigin, isSameOrigin, unauthorized } from "@/server/http";
import { getCurrentUser } from "@/server/session";

export const maxDuration = 300;

const log = createLogger("studio-chat");
const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

async function jobContextFor(jobId: string | null) {
  if (!jobId) return null;
  const [row] = await getDb()
    .select({
      title: jobs.title,
      location: jobs.location,
      description: jobs.descriptionText,
      company: companies.name,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row ?? null;
}

/**
 * Resume Studio chat turn, streamed to the browser as Server-Sent Events:
 * `text` deltas as the AI writes, `resume` when an edit is applied (already saved as a new
 * version), then `done` or `error`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let prepared;
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ValidationError("Invalid resume.");
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new ValidationError("Write a message first (up to 4,000 characters).");
    await enforceRateLimit("aiChat", user.id);
    const resume = await getResume(user.id, id);
    const [{ ai, ctx, charge }, history, job, profile] = await Promise.all([
      aiFor(user, "studio"),
      oldestFirstMessages(resume.id),
      jobContextFor(resume.jobId),
      candidateProfile(user.id),
    ]);
    prepared = { resume, ai, ctx, charge, history, job, profile, message: parsed.data.message };
  } catch (error) {
    return errorResponse(error);
  }

  const { resume, ai, ctx, charge, history, job, profile, message } = prepared;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StudioEvent | { type: "saved"; revisionId: string }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      let lastRevisionId: string | null = null;
      try {
        for await (const event of ai.studioChat(
          { resume: resume.content, history, message, job, profile },
          { ...ctx, signal: request.signal },
        )) {
          if (event.type === "resume") {
            const saved = await saveResumeContent(
              user.id,
              resume.id,
              event.resume,
              "ai_chat",
              event.summary || "Edited with AI",
            );
            lastRevisionId = saved.revisionId;
            send({ ...event, resume: saved.resume.content });
            continue;
          }
          if (event.type === "done") {
            await appendMessages(resume.id, [
              { role: "user", content: message },
              { role: "assistant", content: event.reply, revisionId: lastRevisionId },
            ]);
            await charge(resume.id);
          }
          send(event);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          log.error({ err: error }, "studio chat failed");
          send({ type: "error", message: "Something went wrong. Please try again." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
