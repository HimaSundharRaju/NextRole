import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-primary-soft text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function scoreTone(score: number): "success" | "primary" | "warning" | "neutral" {
  if (score >= 80) return "success";
  if (score >= 65) return "primary";
  if (score >= 50) return "warning";
  return "neutral";
}

export function MatchBadge({ score, className }: { score: number; className?: string }) {
  return (
    <Badge
      tone={scoreTone(score)}
      className={className}
      title="How well this job matches your profile"
    >
      {score}% match
    </Badge>
  );
}
