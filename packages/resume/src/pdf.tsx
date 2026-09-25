import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  DEFAULT_RESUME_SETTINGS,
  formatDateRange,
  isSectionEmpty,
  SECTION_TITLES,
  type Resume,
  type ResumeSettings,
  type SectionKey,
} from "./schema";
import { MUTED_COLOR, TEMPLATE_THEMES, TEXT_COLOR, type TemplateTheme } from "./theme";

// The built-in PDF fonts cover Windows-1252 only. Map common symbols outside it to readable text.
const PDF_REPLACEMENTS: Array<[RegExp, string]> = [
  [/₹/g, "INR "],
  [/→/g, "->"],
  [/←/g, "<-"],
  [/[≥]/g, ">="],
  [/[≤]/g, "<="],
  [/[−‐‑‒]/g, "-"],
  [/[✓✔✅]/g, ""],
  [/[​-‍﻿]/g, ""],
];

export function pdfSafeText(text: string): string {
  return PDF_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function createStyles(theme: TemplateTheme, settings: ResumeSettings) {
  const scale = settings.fontScale;
  const accent = theme.useAccent ? settings.accentColor : TEXT_COLOR;
  return StyleSheet.create({
    page: {
      paddingVertical: theme.pagePadding.vertical,
      paddingHorizontal: theme.pagePadding.horizontal,
      fontFamily: theme.pdfFont.regular,
      fontSize: theme.bodySize * scale,
      lineHeight: theme.lineHeight,
      color: TEXT_COLOR,
    },
    header: { marginBottom: theme.sectionGap, textAlign: theme.centeredHeader ? "center" : "left" },
    name: { fontFamily: theme.pdfFont.bold, fontSize: theme.nameSize * scale, lineHeight: 1.15 },
    headline: { fontSize: theme.headlineSize * scale, color: accent, marginTop: 2 },
    contact: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: theme.centeredHeader ? "center" : "flex-start",
      marginTop: 4,
      color: MUTED_COLOR,
    },
    contactItem: { marginRight: 10 },
    link: { color: MUTED_COLOR, textDecoration: "none" },
    section: { marginBottom: theme.sectionGap },
    sectionTitle: {
      fontFamily: theme.pdfFont.bold,
      fontSize: theme.sectionTitleSize * scale,
      color: accent,
      letterSpacing: theme.uppercaseSectionTitles ? 0.8 : 0,
      textTransform: theme.uppercaseSectionTitles ? "uppercase" : "none",
      paddingBottom: 2,
      marginBottom: 5,
      borderBottomWidth: theme.sectionRule ? 0.75 : 0,
      borderBottomColor: theme.useAccent ? settings.accentColor : "#9ca3af",
    },
    item: { marginBottom: theme.itemGap },
    itemHeader: { flexDirection: "row", justifyContent: "space-between" },
    itemTitle: { fontFamily: theme.pdfFont.bold, flexShrink: 1, paddingRight: 8 },
    itemMeta: { color: MUTED_COLOR, flexShrink: 0 },
    itemSub: { fontFamily: theme.pdfFont.italic, color: MUTED_COLOR },
    bullet: { flexDirection: "row", marginTop: 1.5 },
    bulletMark: { width: 10 },
    bulletText: { flex: 1 },
    muted: { color: MUTED_COLOR },
    bold: { fontFamily: theme.pdfFont.bold },
  });
}

type Styles = ReturnType<typeof createStyles>;

function Bullets({ items, styles }: { items: string[]; styles: Styles }) {
  return (
    <>
      {items.map((item, index) => (
        <View key={index} style={styles.bullet}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{pdfSafeText(item)}</Text>
        </View>
      ))}
    </>
  );
}

function Section({
  title,
  styles,
  children,
}: {
  title: string;
  styles: Styles;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} minPresenceAhead={40}>
        {pdfSafeText(title)}
      </Text>
      {children}
    </View>
  );
}

function renderSection(key: SectionKey, resume: Resume, styles: Styles): ReactNode {
  if (isSectionEmpty(resume, key)) return null;
  switch (key) {
    case "summary":
      return (
        <Section key={key} title={SECTION_TITLES.summary} styles={styles}>
          <Text>{pdfSafeText(resume.summary)}</Text>
        </Section>
      );
    case "experience":
      return (
        <Section key={key} title={SECTION_TITLES.experience} styles={styles}>
          {resume.experience.map((job, index) => (
            <View key={index} style={styles.item} wrap={job.highlights.length > 6}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>
                  {pdfSafeText([job.title, job.company].filter(Boolean).join(", "))}
                </Text>
                <Text style={styles.itemMeta}>
                  {pdfSafeText(formatDateRange(job.startDate, job.endDate))}
                </Text>
              </View>
              {job.location ? (
                <Text style={styles.itemSub}>{pdfSafeText(job.location)}</Text>
              ) : null}
              <Bullets items={job.highlights} styles={styles} />
            </View>
          ))}
        </Section>
      );
    case "projects":
      return (
        <Section key={key} title={SECTION_TITLES.projects} styles={styles}>
          {resume.projects.map((project, index) => (
            <View key={index} style={styles.item} wrap={false}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{pdfSafeText(project.name)}</Text>
                {project.link ? (
                  <Link src={project.link} style={[styles.itemMeta, styles.link]}>
                    {pdfSafeText(displayUrl(project.link))}
                  </Link>
                ) : null}
              </View>
              {project.description ? <Text>{pdfSafeText(project.description)}</Text> : null}
              <Bullets items={project.highlights} styles={styles} />
              {project.technologies.length ? (
                <Text style={styles.muted}>{pdfSafeText(project.technologies.join(" · "))}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      );
    case "skills":
      return (
        <Section key={key} title={SECTION_TITLES.skills} styles={styles}>
          {resume.skills.map((group, index) => (
            <Text key={index} style={{ marginBottom: 2 }}>
              {group.name ? <Text style={styles.bold}>{pdfSafeText(group.name)}: </Text> : null}
              {pdfSafeText(group.items.join(", "))}
            </Text>
          ))}
        </Section>
      );
    case "education":
      return (
        <Section key={key} title={SECTION_TITLES.education} styles={styles}>
          {resume.education.map((school, index) => (
            <View key={index} style={styles.item} wrap={false}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>
                  {pdfSafeText(
                    [[school.degree, school.field].filter(Boolean).join(", "), school.institution]
                      .filter(Boolean)
                      .join(" — "),
                  )}
                </Text>
                <Text style={styles.itemMeta}>
                  {pdfSafeText(formatDateRange(school.startDate, school.endDate))}
                </Text>
              </View>
              {school.location ? (
                <Text style={styles.itemSub}>{pdfSafeText(school.location)}</Text>
              ) : null}
              <Bullets items={school.highlights} styles={styles} />
            </View>
          ))}
        </Section>
      );
    case "certifications":
      return (
        <Section key={key} title={SECTION_TITLES.certifications} styles={styles}>
          {resume.certifications.map((cert, index) => (
            <View key={index} style={styles.itemHeader}>
              <Text style={styles.itemTitle}>
                {pdfSafeText([cert.name, cert.issuer].filter(Boolean).join(" — "))}
              </Text>
              <Text style={styles.itemMeta}>{pdfSafeText(cert.date)}</Text>
            </View>
          ))}
        </Section>
      );
    case "customSections":
      return resume.customSections.map((section, index) => (
        <Section key={`${key}-${index}`} title={section.title} styles={styles}>
          <Bullets items={section.items} styles={styles} />
        </Section>
      ));
  }
}

export function ResumeDocument({
  resume,
  settings = DEFAULT_RESUME_SETTINGS,
}: {
  resume: Resume;
  settings?: ResumeSettings;
}) {
  const theme = TEMPLATE_THEMES[settings.template];
  const styles = createStyles(theme, settings);
  const { basics } = resume;
  const contact = [basics.email, basics.phone, basics.location].filter(Boolean);

  return (
    <Document
      title={pdfSafeText(`${basics.name || "Resume"} — Resume`)}
      author={pdfSafeText(basics.name)}
      subject={pdfSafeText(basics.headline)}
      creator="NextRole"
      producer="NextRole"
    >
      <Page size={settings.paperSize} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{pdfSafeText(basics.name)}</Text>
          {basics.headline ? (
            <Text style={styles.headline}>{pdfSafeText(basics.headline)}</Text>
          ) : null}
          <View style={styles.contact}>
            {contact.map((item, index) => (
              <Text key={index} style={styles.contactItem}>
                {pdfSafeText(item)}
              </Text>
            ))}
            {basics.links.map((link, index) => (
              <Link key={`link-${index}`} src={link.url} style={[styles.contactItem, styles.link]}>
                {pdfSafeText(displayUrl(link.url))}
              </Link>
            ))}
          </View>
        </View>
        {settings.sectionOrder.map((key) => renderSection(key, resume, styles))}
      </Page>
    </Document>
  );
}

export async function renderResumePdf(
  resume: Resume,
  settings: ResumeSettings = DEFAULT_RESUME_SETTINGS,
): Promise<Buffer> {
  return renderToBuffer(<ResumeDocument resume={resume} settings={settings} />);
}
