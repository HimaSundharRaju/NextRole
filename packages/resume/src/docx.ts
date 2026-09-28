import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from "docx";
import {
  DEFAULT_RESUME_SETTINGS,
  formatDateRange,
  isSectionEmpty,
  SECTION_TITLES,
  type Resume,
  type ResumeSettings,
  type SectionKey,
} from "./schema";
import { TEMPLATE_THEMES } from "./theme";

// DOCX measures fonts in half-points and spacing in twentieths of a point.
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);

const BULLET_REF = "resume-bullets";

export async function renderResumeDocx(
  resume: Resume,
  settings: ResumeSettings = DEFAULT_RESUME_SETTINGS,
): Promise<Buffer> {
  const theme = TEMPLATE_THEMES[settings.template];
  const scale = settings.fontScale;
  const font = theme.cssFont.includes("Times") ? "Times New Roman" : "Arial";
  const accent = theme.useAccent ? settings.accentColor.replace("#", "") : "111827";
  const bodySize = halfPoints(theme.bodySize * scale);
  const pageWidthTwips = settings.paperSize === "A4" ? 11906 : 12240;
  const marginTwips = twips(theme.pagePadding.horizontal);
  const rightTab = pageWidthTwips - marginTwips * 2;

  const children: Paragraph[] = [];

  const heading = (title: string) =>
    new Paragraph({
      spacing: { before: twips(theme.sectionGap), after: twips(4) },
      border: theme.sectionRule
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 1 } }
        : undefined,
      children: [
        new TextRun({
          text: theme.uppercaseSectionTitles ? title.toUpperCase() : title,
          bold: true,
          color: accent,
          size: halfPoints(theme.sectionTitleSize * scale),
          characterSpacing: theme.uppercaseSectionTitles ? 16 : 0,
        }),
      ],
    });

  const titleLine = (left: string, right: string) =>
    new Paragraph({
      spacing: { before: twips(theme.itemGap) },
      tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
      children: [
        new TextRun({ text: left, bold: true }),
        ...(right ? [new TextRun({ text: `\t${right}`, color: "4B5563" })] : []),
      ],
    });

  const subLine = (text: string) =>
    new Paragraph({ children: [new TextRun({ text, italics: true, color: "4B5563" })] });

  const bullet = (text: string) =>
    new Paragraph({
      numbering: { reference: BULLET_REF, level: 0 },
      children: [new TextRun(text)],
    });

  // Header
  const { basics } = resume;
  const centered = theme.centeredHeader ? AlignmentType.CENTER : AlignmentType.LEFT;
  children.push(
    new Paragraph({
      alignment: centered,
      children: [
        new TextRun({ text: basics.name, bold: true, size: halfPoints(theme.nameSize * scale) }),
      ],
    }),
  );
  if (basics.headline) {
    children.push(
      new Paragraph({
        alignment: centered,
        children: [
          new TextRun({
            text: basics.headline,
            color: accent,
            size: halfPoints(theme.headlineSize * scale),
          }),
        ],
      }),
    );
  }
  const contactRuns: ParagraphChild[] = [];
  const contactParts = [basics.email, basics.phone, basics.location].filter(Boolean);
  contactParts.forEach((part, index) => {
    if (index > 0) contactRuns.push(new TextRun({ text: "  |  ", color: "9CA3AF" }));
    contactRuns.push(new TextRun({ text: part, color: "4B5563" }));
  });
  basics.links.forEach((link) => {
    if (contactRuns.length > 0) contactRuns.push(new TextRun({ text: "  |  ", color: "9CA3AF" }));
    contactRuns.push(
      new ExternalHyperlink({
        link: link.url,
        children: [
          new TextRun({
            text: link.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""),
            color: "4B5563",
          }),
        ],
      }),
    );
  });
  if (contactRuns.length) {
    children.push(new Paragraph({ alignment: centered, children: contactRuns }));
  }

  const addSection = (key: SectionKey) => {
    if (isSectionEmpty(resume, key)) return;
    switch (key) {
      case "summary":
        children.push(heading(SECTION_TITLES.summary), new Paragraph(resume.summary));
        break;
      case "experience":
        children.push(heading(SECTION_TITLES.experience));
        for (const job of resume.experience) {
          children.push(
            titleLine(
              [job.title, job.company].filter(Boolean).join(", "),
              formatDateRange(job.startDate, job.endDate),
            ),
          );
          if (job.location) children.push(subLine(job.location));
          job.highlights.forEach((item) => children.push(bullet(item)));
        }
        break;
      case "projects":
        children.push(heading(SECTION_TITLES.projects));
        for (const project of resume.projects) {
          children.push(titleLine(project.name, project.link));
          if (project.description) children.push(new Paragraph(project.description));
          project.highlights.forEach((item) => children.push(bullet(item)));
          if (project.technologies.length) {
            children.push(subLine(project.technologies.join(" · ")));
          }
        }
        break;
      case "skills":
        children.push(heading(SECTION_TITLES.skills));
        for (const group of resume.skills) {
          children.push(
            new Paragraph({
              children: [
                ...(group.name ? [new TextRun({ text: `${group.name}: `, bold: true })] : []),
                new TextRun(group.items.join(", ")),
              ],
            }),
          );
        }
        break;
      case "education":
        children.push(heading(SECTION_TITLES.education));
        for (const school of resume.education) {
          const degree = [school.degree, school.field].filter(Boolean).join(", ");
          children.push(
            titleLine(
              [degree, school.institution].filter(Boolean).join(" — "),
              formatDateRange(school.startDate, school.endDate),
            ),
          );
          if (school.location) children.push(subLine(school.location));
          school.highlights.forEach((item) => children.push(bullet(item)));
        }
        break;
      case "certifications":
        children.push(heading(SECTION_TITLES.certifications));
        for (const cert of resume.certifications) {
          children.push(titleLine([cert.name, cert.issuer].filter(Boolean).join(" — "), cert.date));
        }
        break;
      case "customSections":
        for (const section of resume.customSections) {
          children.push(heading(section.title));
          section.items.forEach((item) => children.push(bullet(item)));
        }
        break;
    }
  };
  settings.sectionOrder.forEach(addSection);

  const document = new Document({
    creator: "GetTargetRole",
    title: `${basics.name || "Resume"} — Resume`,
    styles: {
      default: {
        document: {
          run: { font, size: bodySize, color: "111827" },
          paragraph: { spacing: { line: Math.round(240 * theme.lineHeight * 0.9) } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 280, hanging: 200 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size:
              settings.paperSize === "A4"
                ? { width: 11906, height: 16838 }
                : { width: 12240, height: 15840 },
            margin: {
              top: twips(theme.pagePadding.vertical),
              bottom: twips(theme.pagePadding.vertical),
              left: marginTwips,
              right: marginTwips,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
