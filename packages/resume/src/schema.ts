import { z } from "zod";

/*
 * The resume model is shared by the editor, the PDF/DOCX renderers and the AI's structured
 * outputs. Every field is required (empty string / empty array when unknown) so the same schema
 * works with strict JSON-schema tool calls, which do not allow optional properties.
 */

export const resumeLinkSchema = z.object({
  label: z.string().describe("Short label such as LinkedIn, GitHub or Portfolio"),
  url: z.string().describe("Full URL including https://"),
});

export const resumeBasicsSchema = z.object({
  name: z.string(),
  headline: z.string().describe("Professional headline, e.g. 'Senior Backend Engineer'"),
  email: z.string(),
  phone: z.string(),
  location: z.string().describe("City and region/country only, never a street address"),
  links: z.array(resumeLinkSchema),
});

export const experienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string(),
  startDate: z.string().describe("Display date such as 'Mar 2021'"),
  endDate: z.string().describe("Display date such as 'Jun 2024', or 'Present'"),
  highlights: z.array(z.string()).describe("Achievement bullets, strongest first"),
});

export const educationSchema = z.object({
  institution: z.string(),
  degree: z.string().describe("e.g. 'B.Tech' or 'Master of Science'"),
  field: z.string().describe("e.g. 'Computer Science'"),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  highlights: z.array(z.string()).describe("GPA, honors or relevant coursework"),
});

export const skillGroupSchema = z.object({
  name: z.string().describe("Group label such as 'Languages' or 'Cloud & DevOps'"),
  items: z.array(z.string()),
});

export const projectSchema = z.object({
  name: z.string(),
  link: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
  technologies: z.array(z.string()),
});

export const certificationSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
});

export const customSectionSchema = z.object({
  title: z.string().describe("Section title such as 'Awards', 'Publications' or 'Languages'"),
  items: z.array(z.string()),
});

export const resumeSchema = z.object({
  basics: resumeBasicsSchema,
  summary: z.string().describe("2-4 sentence professional summary"),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  skills: z.array(skillGroupSchema),
  projects: z.array(projectSchema),
  certifications: z.array(certificationSchema),
  customSections: z.array(customSectionSchema),
});

export type ResumeLink = z.infer<typeof resumeLinkSchema>;
export type ResumeBasics = z.infer<typeof resumeBasicsSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type SkillGroup = z.infer<typeof skillGroupSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type CustomSection = z.infer<typeof customSectionSchema>;
export type Resume = z.infer<typeof resumeSchema>;

export const SECTION_KEYS = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "certifications",
  "customSections",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
  certifications: "Certifications",
  customSections: "Additional",
};

export const TEMPLATE_IDS = ["modern", "classic", "compact"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const resumeSettingsSchema = z.object({
  template: z.enum(TEMPLATE_IDS).default("modern"),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#1d4ed8"),
  sectionOrder: z.array(z.enum(SECTION_KEYS)).default([...SECTION_KEYS]),
  fontScale: z.number().min(0.85).max(1.15).default(1),
  paperSize: z.enum(["LETTER", "A4"]).default("LETTER"),
});
export type ResumeSettings = z.infer<typeof resumeSettingsSchema>;

export const DEFAULT_RESUME_SETTINGS: ResumeSettings = resumeSettingsSchema.parse({});

export function emptyResume(): Resume {
  return {
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    customSections: [],
  };
}

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();
const cleanList = (values: string[]): string[] => values.map(clean).filter(Boolean);
const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Trims whitespace, drops empty bullets/entries and de-duplicates skills. */
export function normalizeResume(input: Resume): Resume {
  const resume = resumeSchema.parse(input);
  return {
    basics: {
      name: clean(resume.basics.name),
      headline: clean(resume.basics.headline),
      email: clean(resume.basics.email),
      phone: clean(resume.basics.phone),
      location: clean(resume.basics.location),
      links: resume.basics.links
        .map((link) => ({ label: clean(link.label), url: clean(link.url) }))
        .filter((link) => link.url),
    },
    summary: resume.summary.trim(),
    experience: resume.experience
      .map((item) => ({
        company: clean(item.company),
        title: clean(item.title),
        location: clean(item.location),
        startDate: clean(item.startDate),
        endDate: clean(item.endDate),
        highlights: cleanList(item.highlights),
      }))
      .filter((item) => item.company || item.title),
    education: resume.education
      .map((item) => ({
        institution: clean(item.institution),
        degree: clean(item.degree),
        field: clean(item.field),
        location: clean(item.location),
        startDate: clean(item.startDate),
        endDate: clean(item.endDate),
        highlights: cleanList(item.highlights),
      }))
      .filter((item) => item.institution || item.degree),
    skills: resume.skills
      .map((group) => ({ name: clean(group.name), items: dedupe(cleanList(group.items)) }))
      .filter((group) => group.items.length > 0),
    projects: resume.projects
      .map((item) => ({
        name: clean(item.name),
        link: clean(item.link),
        description: clean(item.description),
        highlights: cleanList(item.highlights),
        technologies: dedupe(cleanList(item.technologies)),
      }))
      .filter((item) => item.name),
    certifications: resume.certifications
      .map((item) => ({
        name: clean(item.name),
        issuer: clean(item.issuer),
        date: clean(item.date),
      }))
      .filter((item) => item.name),
    customSections: resume.customSections
      .map((section) => ({ title: clean(section.title), items: cleanList(section.items) }))
      .filter((section) => section.title && section.items.length > 0),
  };
}

export function isSectionEmpty(resume: Resume, key: SectionKey): boolean {
  if (key === "summary") return resume.summary.trim().length === 0;
  return resume[key].length === 0;
}

/** "Mar 2021 – Present" style range; tolerates missing ends. */
export function formatDateRange(start: string, end: string): string {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}
