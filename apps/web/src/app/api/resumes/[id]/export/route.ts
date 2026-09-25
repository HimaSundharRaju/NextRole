import { ValidationError } from "@nextrole/core/errors";
import { enforceRateLimit } from "@nextrole/core/rate-limit";
import { renderResumeDocx } from "@nextrole/resume/docx";
import { renderResumePdf } from "@nextrole/resume/pdf";
import { z } from "zod";
import { getResume } from "@/server/data/resumes";
import { errorResponse, unauthorized } from "@/server/http";
import { getCurrentUser } from "@/server/session";

export const maxDuration = 60;

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

function fileNameFor(name: string, format: "pdf" | "docx"): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "resume"}-resume.${format}`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ValidationError("Invalid resume.");
    const format = new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
    await enforceRateLimit("export", user.id);
    const resume = await getResume(user.id, id);
    const file =
      format === "pdf"
        ? await renderResumePdf(resume.content, resume.settings)
        : await renderResumeDocx(resume.content, resume.settings);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${fileNameFor(resume.content.basics.name || resume.title, format)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
