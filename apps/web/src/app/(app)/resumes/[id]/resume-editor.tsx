"use client";

import {
  type Certification,
  type CustomSection,
  type Education,
  type Experience,
  type Project,
  type Resume,
  type SkillGroup,
} from "@gettargetrole/resume/schema";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
const commas = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </label>
  );
}

function LinesField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Textarea
        value={text}
        rows={Math.min(8, Math.max(3, value.length + 1))}
        onChange={(event) => {
          setText(event.target.value);
          onChange(lines(event.target.value));
        }}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function ListEditor<T>({
  title,
  items,
  onChange,
  create,
  render,
  itemLabel,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
  itemLabel: (item: T) => string;
}) {
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {itemLabel(item) || `Entry ${index + 1}`}
            </span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                aria-label="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded p-1 text-danger hover:bg-danger-soft"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {render(item, (patch) =>
              onChange(
                items.map((current, i) => (i === index ? { ...current, ...patch } : current)),
              ),
            )}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, create()])}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add {title.toLowerCase().replace(/s$/, "")}
      </Button>
    </fieldset>
  );
}

export function ResumeEditor({
  initial,
  saving,
  onSave,
}: {
  initial: Resume;
  saving: boolean;
  onSave: (resume: Resume) => void;
}) {
  const [resume, setResume] = useState<Resume>(initial);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Resume>(key: K, value: Resume[K]) => {
    setResume((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const setBasics = (patch: Partial<Resume["basics"]>) =>
    set("basics", { ...resume.basics, ...patch });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Contact</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField
              label="Full name"
              value={resume.basics.name}
              onChange={(name) => setBasics({ name })}
            />
            <TextField
              label="Headline"
              value={resume.basics.headline}
              onChange={(headline) => setBasics({ headline })}
            />
            <TextField
              label="Email"
              value={resume.basics.email}
              onChange={(email) => setBasics({ email })}
            />
            <TextField
              label="Phone"
              value={resume.basics.phone}
              onChange={(phone) => setBasics({ phone })}
            />
            <TextField
              label="Location"
              value={resume.basics.location}
              onChange={(location) => setBasics({ location })}
              placeholder="City, Region"
            />
          </div>
          <LinesField
            label="Links (one per line)"
            value={resume.basics.links.map((link) => link.url)}
            hint="LinkedIn, GitHub, portfolio — full https:// URLs"
            onChange={(urls) =>
              setBasics({
                links: urls.map((url) => ({
                  url: url.trim(),
                  label: /linkedin/i.test(url)
                    ? "LinkedIn"
                    : /github/i.test(url)
                      ? "GitHub"
                      : "Website",
                })),
              })
            }
          />
        </fieldset>

        <fieldset className="space-y-1">
          <Label htmlFor="summary" className="mb-2 block text-sm font-semibold">
            Summary
          </Label>
          <Textarea
            id="summary"
            value={resume.summary}
            rows={4}
            onChange={(event) => set("summary", event.target.value)}
          />
        </fieldset>

        <ListEditor<Experience>
          title="Experience"
          items={resume.experience}
          onChange={(items) => set("experience", items)}
          itemLabel={(item) => [item.title, item.company].filter(Boolean).join(" · ")}
          create={() => ({
            company: "",
            title: "",
            location: "",
            startDate: "",
            endDate: "",
            highlights: [],
          })}
          render={(item, update) => (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField
                  label="Title"
                  value={item.title}
                  onChange={(title) => update({ title })}
                />
                <TextField
                  label="Company"
                  value={item.company}
                  onChange={(company) => update({ company })}
                />
                <TextField
                  label="Start"
                  value={item.startDate}
                  onChange={(startDate) => update({ startDate })}
                  placeholder="Mar 2021"
                />
                <TextField
                  label="End"
                  value={item.endDate}
                  onChange={(endDate) => update({ endDate })}
                  placeholder="Present"
                />
                <TextField
                  label="Location"
                  value={item.location}
                  onChange={(location) => update({ location })}
                />
              </div>
              <LinesField
                label="Bullets (one per line)"
                value={item.highlights}
                onChange={(highlights) => update({ highlights })}
              />
            </>
          )}
        />

        <ListEditor<Project>
          title="Projects"
          items={resume.projects}
          onChange={(items) => set("projects", items)}
          itemLabel={(item) => item.name}
          create={() => ({ name: "", link: "", description: "", highlights: [], technologies: [] })}
          render={(item, update) => (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="Name" value={item.name} onChange={(name) => update({ name })} />
                <TextField label="Link" value={item.link} onChange={(link) => update({ link })} />
              </div>
              <TextField
                label="Description"
                value={item.description}
                onChange={(description) => update({ description })}
              />
              <LinesField
                label="Bullets (one per line)"
                value={item.highlights}
                onChange={(highlights) => update({ highlights })}
              />
              <TextField
                label="Technologies (comma separated)"
                value={item.technologies.join(", ")}
                onChange={(value) => update({ technologies: commas(value) })}
              />
            </>
          )}
        />

        <ListEditor<SkillGroup>
          title="Skills"
          items={resume.skills}
          onChange={(items) => set("skills", items)}
          itemLabel={(item) => item.name}
          create={() => ({ name: "", items: [] })}
          render={(item, update) => (
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <TextField
                label="Group"
                value={item.name}
                onChange={(name) => update({ name })}
                placeholder="Languages"
              />
              <TextField
                label="Skills (comma separated)"
                value={item.items.join(", ")}
                onChange={(value) => update({ items: commas(value) })}
              />
            </div>
          )}
        />

        <ListEditor<Education>
          title="Education"
          items={resume.education}
          onChange={(items) => set("education", items)}
          itemLabel={(item) => item.institution}
          create={() => ({
            institution: "",
            degree: "",
            field: "",
            location: "",
            startDate: "",
            endDate: "",
            highlights: [],
          })}
          render={(item, update) => (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField
                  label="Institution"
                  value={item.institution}
                  onChange={(institution) => update({ institution })}
                />
                <TextField
                  label="Degree"
                  value={item.degree}
                  onChange={(degree) => update({ degree })}
                />
                <TextField
                  label="Field of study"
                  value={item.field}
                  onChange={(field) => update({ field })}
                />
                <TextField
                  label="Location"
                  value={item.location}
                  onChange={(location) => update({ location })}
                />
                <TextField
                  label="Start"
                  value={item.startDate}
                  onChange={(startDate) => update({ startDate })}
                />
                <TextField
                  label="End"
                  value={item.endDate}
                  onChange={(endDate) => update({ endDate })}
                />
              </div>
              <LinesField
                label="Details (one per line)"
                value={item.highlights}
                onChange={(highlights) => update({ highlights })}
              />
            </>
          )}
        />

        <ListEditor<Certification>
          title="Certifications"
          items={resume.certifications}
          onChange={(items) => set("certifications", items)}
          itemLabel={(item) => item.name}
          create={() => ({ name: "", issuer: "", date: "" })}
          render={(item, update) => (
            <div className="grid gap-2 sm:grid-cols-3">
              <TextField label="Name" value={item.name} onChange={(name) => update({ name })} />
              <TextField
                label="Issuer"
                value={item.issuer}
                onChange={(issuer) => update({ issuer })}
              />
              <TextField label="Date" value={item.date} onChange={(date) => update({ date })} />
            </div>
          )}
        />

        <ListEditor<CustomSection>
          title="Other sections"
          items={resume.customSections}
          onChange={(items) => set("customSections", items)}
          itemLabel={(item) => item.title}
          create={() => ({ title: "", items: [] })}
          render={(item, update) => (
            <>
              <TextField
                label="Section title"
                value={item.title}
                onChange={(title) => update({ title })}
                placeholder="Awards"
              />
              <LinesField
                label="Items (one per line)"
                value={item.items}
                onChange={(items) => update({ items })}
              />
            </>
          )}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border p-3">
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="flex gap-2">
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResume(initial);
                setDirty(false);
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button
            size="sm"
            loading={saving}
            disabled={!dirty}
            onClick={() => {
              onSave(resume);
              setDirty(false);
            }}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
