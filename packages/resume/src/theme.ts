import type { TemplateId } from "./schema";

/**
 * Visual tokens shared by the PDF renderer and the in-app HTML preview so both look the same.
 * Sizes are in points (1pt = 1/72in); the HTML preview maps them 1:1 to CSS `pt`.
 * All templates are single-column with real text, which parses reliably in every ATS.
 */
export interface TemplateTheme {
  id: TemplateId;
  label: string;
  description: string;
  pdfFont: { regular: string; bold: string; italic: string };
  cssFont: string;
  nameSize: number;
  headlineSize: number;
  bodySize: number;
  sectionTitleSize: number;
  sectionGap: number;
  itemGap: number;
  lineHeight: number;
  pagePadding: { vertical: number; horizontal: number };
  uppercaseSectionTitles: boolean;
  sectionRule: boolean;
  useAccent: boolean;
  centeredHeader: boolean;
}

export const TEMPLATE_THEMES: Record<TemplateId, TemplateTheme> = {
  modern: {
    id: "modern",
    label: "Modern",
    description: "Clean sans-serif with an accent colour. Great for tech and product roles.",
    pdfFont: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
    cssFont: "Helvetica, Arial, sans-serif",
    nameSize: 22,
    headlineSize: 11.5,
    bodySize: 10,
    sectionTitleSize: 11,
    sectionGap: 12,
    itemGap: 7,
    lineHeight: 1.38,
    pagePadding: { vertical: 38, horizontal: 44 },
    uppercaseSectionTitles: true,
    sectionRule: true,
    useAccent: true,
    centeredHeader: false,
  },
  classic: {
    id: "classic",
    label: "Classic",
    description: "Traditional serif layout. Suits finance, law, consulting and academia.",
    pdfFont: { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" },
    cssFont: "'Times New Roman', Times, serif",
    nameSize: 21,
    headlineSize: 11.5,
    bodySize: 10.5,
    sectionTitleSize: 11.5,
    sectionGap: 11,
    itemGap: 7,
    lineHeight: 1.33,
    pagePadding: { vertical: 40, horizontal: 48 },
    uppercaseSectionTitles: true,
    sectionRule: true,
    useAccent: false,
    centeredHeader: true,
  },
  compact: {
    id: "compact",
    label: "Compact",
    description: "Dense one-page layout for experienced candidates with a lot to show.",
    pdfFont: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
    cssFont: "Helvetica, Arial, sans-serif",
    nameSize: 18,
    headlineSize: 10.5,
    bodySize: 9.2,
    sectionTitleSize: 10,
    sectionGap: 8,
    itemGap: 5,
    lineHeight: 1.3,
    pagePadding: { vertical: 30, horizontal: 36 },
    uppercaseSectionTitles: true,
    sectionRule: false,
    useAccent: true,
    centeredHeader: false,
  },
};

export const TEXT_COLOR = "#111827";
export const MUTED_COLOR = "#4b5563";
