import { exportLinkUsable, getDb } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Download your data" };

/**
 * The page a data-export email links to. Opening it uses nothing up; the button posts the key to
 * the download route, which is what uses the link, once.
 */
export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const usable = key ? await exportLinkUsable(getDb(), key) : false;
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Download your data" />
      <Card>
        <CardBody className="space-y-4 text-sm">
          {usable ? (
            <>
              <p>
                This is everything GetTargetRole stores about you, as one file. The link works once
                and expires 24 hours after we sent it.
              </p>
              <form method="post" action="/api/account/export/link">
                <input type="hidden" name="key" value={key} />
                <Button type="submit">Download my data</Button>
              </form>
            </>
          ) : (
            <p>
              This link has expired or was already used.{" "}
              <Link href="/support" className="font-medium text-primary">
                Contact support
              </Link>{" "}
              for a new one.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
