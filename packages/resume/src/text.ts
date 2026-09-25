import { formatDateRange, type Resume } from "./schema";

/** Plain-text rendering used for keyword matching and as compact context for AI prompts. */
export function resumeToPlainText(resume: Resume): string {
  const lines: string[] = [];
  const { basics } = resume;
  lines.push(basics.name, basics.headline);
  lines.push([basics.email, basics.phone, basics.location].filter(Boolean).join(" | "));
  for (const link of basics.links) lines.push(`${link.label}: ${link.url}`);

  if (resume.summary) lines.push("", "SUMMARY", resume.summary);

  if (resume.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const job of resume.experience) {
      lines.push(
        `${job.title} — ${job.company}${job.location ? `, ${job.location}` : ""} (${formatDateRange(job.startDate, job.endDate)})`,
      );
      for (const bullet of job.highlights) lines.push(`- ${bullet}`);
    }
  }

  if (resume.projects.length) {
    lines.push("", "PROJECTS");
    for (const project of resume.projects) {
      lines.push(`${project.name}${project.link ? ` (${project.link})` : ""}`);
      if (project.description) lines.push(project.description);
      for (const bullet of project.highlights) lines.push(`- ${bullet}`);
      if (project.technologies.length)
        lines.push(`Technologies: ${project.technologies.join(", ")}`);
    }
  }

  if (resume.skills.length) {
    lines.push("", "SKILLS");
    for (const group of resume.skills) lines.push(`${group.name}: ${group.items.join(", ")}`);
  }

  if (resume.education.length) {
    lines.push("", "EDUCATION");
    for (const school of resume.education) {
      const degree = [school.degree, school.field].filter(Boolean).join(", ");
      lines.push(
        `${degree} — ${school.institution} (${formatDateRange(school.startDate, school.endDate)})`,
      );
      for (const bullet of school.highlights) lines.push(`- ${bullet}`);
    }
  }

  if (resume.certifications.length) {
    lines.push("", "CERTIFICATIONS");
    for (const cert of resume.certifications) {
      lines.push([cert.name, cert.issuer, cert.date].filter(Boolean).join(" — "));
    }
  }

  for (const section of resume.customSections) {
    lines.push("", section.title.toUpperCase());
    for (const item of section.items) lines.push(`- ${item}`);
  }

  return lines
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n")
    .trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
