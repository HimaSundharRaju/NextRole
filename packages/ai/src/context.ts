import type { Resume } from "@gettargetrole/resume/schema";
import { resumeToPlainText } from "@gettargetrole/resume/text";
import type { CandidateProfile, JobContext } from "./types";
import { wrapUntrusted } from "./untrusted";

// Job pages occasionally embed huge boilerplate; beyond this the text is almost certainly noise.
const MAX_JOB_DESCRIPTION_CHARS = 60_000;

export function resumeJson(resume: Resume, tag = "resume"): string {
  return wrapUntrusted(tag, JSON.stringify(resume, null, 1));
}

export function resumeText(resume: Resume): string {
  return wrapUntrusted("resume", resumeToPlainText(resume));
}

export function jobBlock(job: JobContext): string {
  const description =
    job.description.length > MAX_JOB_DESCRIPTION_CHARS
      ? `${job.description.slice(0, MAX_JOB_DESCRIPTION_CHARS)}\n[description truncated]`
      : job.description;
  return wrapUntrusted(
    "job_description",
    [
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      `Location: ${job.location || "Not stated"}`,
      "",
      description,
    ].join("\n"),
  );
}

export function profileBlock(profile: CandidateProfile | null | undefined): string {
  if (!profile) return wrapUntrusted("candidate_profile", "No profile details provided.");
  const salary = profile.minSalary
    ? `${profile.salaryCurrency} ${profile.minSalary.toLocaleString("en-US")} minimum`
    : "Not provided";
  return wrapUntrusted(
    "candidate_profile",
    [
      `Target roles: ${profile.targetTitles.join(", ") || "Not provided"}`,
      `Work authorization: ${profile.workAuthorization || "Not provided"}`,
      `Needs visa sponsorship: ${profile.workAuthorization ? (profile.needsSponsorship ? "Yes" : "No") : "Not provided"}`,
      `Salary expectation: ${salary}`,
      `Phone: ${profile.phone || "Not provided"}`,
      `LinkedIn: ${profile.linkedinUrl || "Not provided"}`,
      `Voice and extra context from the candidate: ${profile.voiceNotes || "None"}`,
    ].join("\n"),
  );
}
