import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { formatDate } from "@/lib/utils";
import { searchUsers } from "@/server/data/admin";

/** Find an account by name or email, then open it to help. */
export async function UsersTab({ query }: { query?: string }) {
  const rows = await searchUsers(query);
  return (
    <div className="space-y-4">
      <form className="flex gap-2" action="/care">
        <input type="hidden" name="tab" value="users" />
        <Input
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="h-9 max-w-sm"
        />
        <Button type="submit" size="sm" variant="secondary">
          Search
        </Button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Joined</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2">
                  <p className="font-medium">
                    {row.name} {row.banned ? <Badge tone="danger">Banned</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </td>
                <td className="px-4 py-2 capitalize">{row.plan}</td>
                <td className="px-4 py-2">
                  {row.role === "user" ? (
                    <span className="text-muted-foreground">User</span>
                  ) : (
                    <Badge tone="outline" className="capitalize">
                      {row.role}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(row.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/care/users/${row.id}`} className="font-medium text-primary">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No one found.</p>
        ) : null}
      </div>
    </div>
  );
}
