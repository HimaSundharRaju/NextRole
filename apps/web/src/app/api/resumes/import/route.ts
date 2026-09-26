import type { ResumeSource } from "@gettargetrole/ai";
import { ValidationError } from "@gettargetrole/core/errors";
import { enforceRateLimit } from "@gettargetrole/core/rate-limit";
import { NextResponse } from "next/server";
import { aiFor } from "@/server/ai";
import { recordAudit } from "@/server/audit";
import { createResume } from "@/server/data/resumes";
import { errorResponse, forbiddenOrigin, isSameOrigin, unauthorized } from "@/server/http";
import { getCurrentUser } from "@/server/session";

export const maxDuration = 180;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 256 * 1024;

/** Detects the real file type from its bytes instead of trusting the name or MIME type. */
function detectKind(bytes: Buffer, fileName: string): "pdf" | "docx" {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip && /\.docx$/i.test(fileName)) return "docx";
  throw new ValidationError("Upload a PDF or Word (.docx) file.");
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "resume";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES)
      throw new ValidationError("Files must be 5 MB or smaller.");
    await enforceRateLimit("resumeImport", user.id);

    const form = await request.formData();
    const file = form.get("file");
    const text = form.get("text");
    const makePrimary = form.get("makePrimary") === "true";

    let source: ResumeSource;
    let fileName: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) throw new ValidationError("Files must be 5 MB or smaller.");
      const data = Buffer.from(await file.arrayBuffer());
      fileName = safeFileName(file.name);
      source = { kind: detectKind(data, fileName), data, fileName };
    } else if (typeof text === "string" && text.trim().length >= 50) {
      source = { kind: "text", text };
    } else {
      throw new ValidationError("Upload a file or paste at least a few lines of your resume.");
    }

    const { ai, ctx, charge } = await aiFor(user, "import");
    const result = await ai.importResume(source, ctx);
    const title = result.resume.basics.name
      ? `${result.resume.basics.name} — resume`
      : "Imported resume";
    const resume = await createResume(user.id, {
      title,
      content: result.resume,
      source: "import",
      note: fileName ? `Imported from ${fileName}` : "Imported from pasted text",
      sourceFileName: fileName,
      makePrimary,
    });
    await charge(resume.id);
    await recordAudit({
      actorUserId: user.id,
      action: "resume.import",
      targetType: "resume",
      targetId: resume.id,
    });
    return NextResponse.json({
      id: resume.id,
      name: result.resume.basics.name,
      headline: result.resume.basics.headline,
      notes: result.notes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
