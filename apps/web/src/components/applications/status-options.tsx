import type { ApplicationStatus } from "@gettargetrole/db/schema";
import { CLIENT_SELECTABLE_STATUSES, STATUS_META } from "@/lib/statuses";

/**
 * A status select's options: the tracker moves anyone can pick, plus the current status when it's
 * a Concierge step, which moves through its own actions but should still show as selected.
 */
export function StatusOptions({ current }: { current: ApplicationStatus }) {
  return (
    <>
      {CLIENT_SELECTABLE_STATUSES.includes(current) ? null : (
        <option value={current} disabled>
          {STATUS_META[current].label}
        </option>
      )}
      {CLIENT_SELECTABLE_STATUSES.map((value) => (
        <option key={value} value={value}>
          {STATUS_META[value].label}
        </option>
      ))}
    </>
  );
}
