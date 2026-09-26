"use server";

import { ValidationError } from "@gettargetrole/core/errors";
import { companyRequests, getDb } from "@gettargetrole/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { enqueueCompanyRequests } from "@/server/queue";

/**
 * Asks for a company we don't track yet, by name or by a link to its careers page. The worker
 * looks for its job board within minutes; the jobs page shows how the request went.
 */
export const requestCompany = authedAction(
  z.object({ query: z.string().trim().min(2, "Enter a company name or link").max(300) }),
  async ({ query }, user) => {
    // "https://…", or something shaped like a site ("acme.com/careers"), is a link.
    const link = /^https?:\/\//i.test(query) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(query);
    let url = "";
    if (link) {
      try {
        url = new URL(/^https?:\/\//i.test(query) ? query : `https://${query}`).href;
      } catch {
        throw new ValidationError("That link doesn't look right. Check it, or enter the name.");
      }
    }
    await getDb()
      .insert(companyRequests)
      .values({ userId: user.id, source: "user", name: url ? "" : query, url });
    // The worker may be down; the scheduled lookup picks the request up later.
    await enqueueCompanyRequests().catch(() => undefined);
    revalidatePath("/jobs");
    return null;
  },
  { rateLimit: "companyRequest" },
);
