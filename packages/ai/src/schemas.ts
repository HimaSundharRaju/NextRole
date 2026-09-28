import {
  certificationSchema,
  customSectionSchema,
  educationSchema,
  experienceSchema,
  projectSchema,
  resumeBasicsSchema,
  resumeSchema,
  skillGroupSchema,
} from "@gettargetrole/resume/schema";
import { z } from "zod";

export const importResultSchema = z.object({
  resume: resumeSchema,
  notes: z.array(z.string()).describe("Anything that could not be parsed or looked garbled"),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const generateResultSchema = z.object({
  resume: resumeSchema,
  suggestions: z
    .array(z.string())
    .describe("Missing facts the candidate should add, e.g. metrics or dates"),
});
export type GenerateResult = z.infer<typeof generateResultSchema>;

export const tailorResultSchema = z.object({
  resume: resumeSchema,
  summaryOfChanges: z
    .array(z.string())
    .describe("3-6 plain-language bullets describing what changed"),
  addedKeywords: z.array(z.string()).describe("Job keywords now present that were not before"),
  missingKeywords: z
    .array(z.string())
    .describe("Important requirements the candidate does not show"),
  suggestions: z.array(z.string()).describe("Specific additions the candidate could make if true"),
});
export type TailorResult = z.infer<typeof tailorResultSchema>;

export const fitAnalysisSchema = z.object({
  score: z.number().describe("Fit score from 0 to 100"),
  verdict: z.enum(["strong", "good", "stretch", "poor"]),
  summary: z.string().describe("Two-sentence assessment"),
  strengths: z.array(z.string()).describe("3-5 strengths, each citing evidence from the resume"),
  gaps: z.array(z.string()).describe("0-5 specific gaps"),
  recommendation: z.string().describe("One sentence: apply now, tailor first, or skip, and why"),
});
export type FitAnalysis = z.infer<typeof fitAnalysisSchema>;

export const coverLetterSchema = z.object({
  subject: z.string().describe("Email subject line for applications sent by email"),
  body: z.string().describe("Plain-text letter; paragraphs separated by blank lines"),
});
export type CoverLetter = z.infer<typeof coverLetterSchema>;

export const applicationAnswersSchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
});
export type ApplicationAnswers = z.infer<typeof applicationAnswersSchema>;

export const outreachDraftSchema = z.object({
  email: z.object({ subject: z.string(), body: z.string() }),
  linkedinNote: z.string().describe("Connection request note, at most 280 characters"),
  followUp: z.object({ subject: z.string(), body: z.string() }),
});
export type OutreachDraft = z.infer<typeof outreachDraftSchema>;

export const interviewPrepSchema = z.object({
  questions: z.array(
    z.object({
      category: z.enum(["behavioral", "technical", "role", "motivation"]),
      question: z.string(),
      whyTheyAsk: z.string(),
      answerOutline: z.string().describe("Outline drawn from the candidate's real experience"),
    }),
  ),
  questionsToAsk: z.array(z.string()),
});
export type InterviewPrep = z.infer<typeof interviewPrepSchema>;

/** Input of the Resume Studio `update_resume` tool: only changed sections are non-null. */
export const resumeChangesSchema = z.object({
  change_summary: z
    .string()
    .describe("One short sentence describing the edit, shown in version history"),
  basics: resumeBasicsSchema.nullable(),
  summary: z.string().nullable(),
  experience: z.array(experienceSchema).nullable(),
  education: z.array(educationSchema).nullable(),
  skills: z.array(skillGroupSchema).nullable(),
  projects: z.array(projectSchema).nullable(),
  certifications: z.array(certificationSchema).nullable(),
  customSections: z.array(customSectionSchema).nullable(),
});
export type ResumeChanges = z.infer<typeof resumeChangesSchema>;
