"use client";

import type { Resume, ResumeSettings } from "@nextrole/resume/schema";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ResumePreview } from "./resume-preview";

const PAPER_PX = { LETTER: { w: 816, h: 1056 }, A4: { w: 794, h: 1123 } } as const;

/** Fits the full-size resume "paper" to the available width. */
export function ScaledPreview({
  resume,
  settings,
  className,
}: {
  resume: Resume;
  settings: ResumeSettings;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const paper = PAPER_PX[settings.paperSize];
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>(paper.h);

  useEffect(() => {
    const container = containerRef.current;
    const element = paperRef.current;
    if (!container || !element) return;
    const update = () => {
      const next = Math.min(1, (container.clientWidth - 32) / paper.w);
      setScale(next);
      setHeight(element.offsetHeight * next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [paper.w]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full min-h-[24rem] overflow-y-auto overflow-x-hidden rounded-xl bg-muted/60 p-4",
        className,
      )}
    >
      <div
        style={{ width: paper.w * scale, height }}
        className="mx-auto"
        aria-label="Resume preview"
      >
        <div
          ref={paperRef}
          style={{ width: paper.w, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <ResumePreview resume={resume} settings={settings} />
        </div>
      </div>
    </div>
  );
}
