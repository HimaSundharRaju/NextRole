import {
  formatDateRange,
  isSectionEmpty,
  SECTION_TITLES,
  type Resume,
  type ResumeSettings,
  type SectionKey,
} from "@gettargetrole/resume/schema";
import {
  MUTED_COLOR,
  TEMPLATE_THEMES,
  TEXT_COLOR,
  type TemplateTheme,
} from "@gettargetrole/resume/theme";
import type { CSSProperties, ReactNode } from "react";

/*
 * HTML twin of the PDF template in packages/resume/src/pdf.tsx. It uses the same theme tokens
 * (in points) so what users see here is what they download.
 */

const PAGE_WIDTH_PT = { LETTER: 612, A4: 595 } as const;

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function Bullets({ items, gap }: { items: string[]; gap: number }) {
  if (!items.length) return null;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {items.map((item, index) => (
        <li key={index} style={{ display: "flex", marginTop: gap }}>
          <span style={{ width: "10pt", flexShrink: 0 }}>•</span>
          <span style={{ flex: 1 }}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ResumePreview({ resume, settings }: { resume: Resume; settings: ResumeSettings }) {
  const theme: TemplateTheme = TEMPLATE_THEMES[settings.template];
  const scale = settings.fontScale;
  const accent = theme.useAccent ? settings.accentColor : TEXT_COLOR;
  const pt = (value: number) => `${value}pt`;

  const titleStyle: CSSProperties = {
    fontWeight: 700,
    fontSize: pt(theme.sectionTitleSize * scale),
    color: accent,
    letterSpacing: theme.uppercaseSectionTitles ? "0.8pt" : undefined,
    textTransform: theme.uppercaseSectionTitles ? "uppercase" : undefined,
    paddingBottom: pt(2),
    margin: `0 0 ${pt(5)} 0`,
    borderBottom: theme.sectionRule
      ? `0.75pt solid ${theme.useAccent ? settings.accentColor : "#9ca3af"}`
      : undefined,
  };
  const itemHeader: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: pt(8),
  };
  const meta: CSSProperties = { color: MUTED_COLOR, flexShrink: 0 };
  const sub: CSSProperties = { color: MUTED_COLOR, fontStyle: "italic" };
  const item: CSSProperties = { marginBottom: pt(theme.itemGap) };
  const sectionWrap: CSSProperties = { marginBottom: pt(theme.sectionGap) };

  const renderSection = (key: SectionKey): ReactNode => {
    if (isSectionEmpty(resume, key)) return null;
    switch (key) {
      case "summary":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.summary}</h2>
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{resume.summary}</p>
          </section>
        );
      case "experience":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.experience}</h2>
            {resume.experience.map((job, index) => (
              <div key={index} style={item}>
                <div style={itemHeader}>
                  <strong>{[job.title, job.company].filter(Boolean).join(", ")}</strong>
                  <span style={meta}>{formatDateRange(job.startDate, job.endDate)}</span>
                </div>
                {job.location ? <div style={sub}>{job.location}</div> : null}
                <Bullets items={job.highlights} gap={1.5} />
              </div>
            ))}
          </section>
        );
      case "projects":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.projects}</h2>
            {resume.projects.map((project, index) => (
              <div key={index} style={item}>
                <div style={itemHeader}>
                  <strong>{project.name}</strong>
                  {project.link ? <span style={meta}>{displayUrl(project.link)}</span> : null}
                </div>
                {project.description ? <div>{project.description}</div> : null}
                <Bullets items={project.highlights} gap={1.5} />
                {project.technologies.length ? (
                  <div style={{ color: MUTED_COLOR }}>{project.technologies.join(" · ")}</div>
                ) : null}
              </div>
            ))}
          </section>
        );
      case "skills":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.skills}</h2>
            {resume.skills.map((group, index) => (
              <div key={index} style={{ marginBottom: pt(2) }}>
                {group.name ? <strong>{group.name}: </strong> : null}
                {group.items.join(", ")}
              </div>
            ))}
          </section>
        );
      case "education":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.education}</h2>
            {resume.education.map((school, index) => (
              <div key={index} style={item}>
                <div style={itemHeader}>
                  <strong>
                    {[[school.degree, school.field].filter(Boolean).join(", "), school.institution]
                      .filter(Boolean)
                      .join(" — ")}
                  </strong>
                  <span style={meta}>{formatDateRange(school.startDate, school.endDate)}</span>
                </div>
                {school.location ? <div style={sub}>{school.location}</div> : null}
                <Bullets items={school.highlights} gap={1.5} />
              </div>
            ))}
          </section>
        );
      case "certifications":
        return (
          <section key={key} style={sectionWrap}>
            <h2 style={titleStyle}>{SECTION_TITLES.certifications}</h2>
            {resume.certifications.map((cert, index) => (
              <div key={index} style={itemHeader}>
                <strong>{[cert.name, cert.issuer].filter(Boolean).join(" — ")}</strong>
                <span style={meta}>{cert.date}</span>
              </div>
            ))}
          </section>
        );
      case "customSections":
        return resume.customSections.map((section, index) => (
          <section key={`custom-${index}`} style={sectionWrap}>
            <h2 style={titleStyle}>{section.title}</h2>
            <Bullets items={section.items} gap={1.5} />
          </section>
        ));
    }
  };

  const { basics } = resume;
  const contact = [basics.email, basics.phone, basics.location].filter(Boolean);

  return (
    <div
      className="resume-paper"
      style={{
        width: pt(PAGE_WIDTH_PT[settings.paperSize]),
        minHeight: pt(settings.paperSize === "A4" ? 842 : 792),
        padding: `${pt(theme.pagePadding.vertical)} ${pt(theme.pagePadding.horizontal)}`,
        fontFamily: theme.cssFont,
        fontSize: pt(theme.bodySize * scale),
        lineHeight: theme.lineHeight,
        color: TEXT_COLOR,
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          marginBottom: pt(theme.sectionGap),
          textAlign: theme.centeredHeader ? "center" : "left",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: pt(theme.nameSize * scale), lineHeight: 1.15 }}>
          {basics.name || "Your Name"}
        </div>
        {basics.headline ? (
          <div
            style={{ fontSize: pt(theme.headlineSize * scale), color: accent, marginTop: pt(2) }}
          >
            {basics.headline}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: `0 ${pt(10)}`,
            justifyContent: theme.centeredHeader ? "center" : "flex-start",
            marginTop: pt(4),
            color: MUTED_COLOR,
          }}
        >
          {contact.map((value) => (
            <span key={value}>{value}</span>
          ))}
          {basics.links.map((link) => (
            <span key={link.url}>{displayUrl(link.url)}</span>
          ))}
        </div>
      </header>
      {settings.sectionOrder.map(renderSection)}
    </div>
  );
}
