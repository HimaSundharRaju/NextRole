import type { UsageUnit } from "@gettargetrole/db/plans";
import { ProgressBar } from "@/components/ui/misc";
import { USAGE_UNIT_LABEL, type UnitAllowance } from "@/lib/plans";

function tone(allowance: UnitAllowance) {
  if (allowance.left === 0) return "danger" as const;
  return allowance.used / allowance.limit >= 0.8 ? ("warning" as const) : ("primary" as const);
}

/** One bar per allowance the plan includes; allowances the plan doesn't include are left out. */
export function UsageBars({
  allowances,
  units,
}: {
  allowances: Record<UsageUnit, UnitAllowance>;
  units: readonly UsageUnit[];
}) {
  const shown = units.filter((unit) => allowances[unit].limit > 0);
  return (
    <ul className="space-y-3">
      {shown.map((unit) => {
        const allowance = allowances[unit];
        return (
          <li key={unit}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{USAGE_UNIT_LABEL[unit]}</span>
              <span className="tabular-nums">
                {allowance.used} / {allowance.limit}
              </span>
            </div>
            <ProgressBar
              value={(allowance.used / allowance.limit) * 100}
              tone={tone(allowance)}
              className="mt-1"
            />
          </li>
        );
      })}
    </ul>
  );
}

/** "28 of 40 left this month" under an AI button, or why it's unavailable. */
export function AllowanceNote({ allowance }: { allowance: UnitAllowance }) {
  if (allowance.blocked) {
    return (
      <p className="text-xs text-muted-foreground">
        {allowance.blocked}{" "}
        <a href="/settings#plan" className="font-medium text-primary">
          Compare plans
        </a>
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {allowance.left} of {allowance.limit} left this month
    </p>
  );
}
