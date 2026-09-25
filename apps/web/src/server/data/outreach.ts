import "server-only";
import { NotFoundError } from "@nextrole/core/errors";
import { applications, getDb, outreachMessages } from "@nextrole/db";
import { and, desc, eq } from "drizzle-orm";

export async function listOutreach(userId: string) {
  return getDb()
    .select({
      message: outreachMessages,
      companyName: applications.companyName,
      jobTitle: applications.jobTitle,
    })
    .from(outreachMessages)
    .leftJoin(applications, eq(outreachMessages.applicationId, applications.id))
    .where(eq(outreachMessages.userId, userId))
    .orderBy(desc(outreachMessages.createdAt))
    .limit(200);
}

export async function createOutreach(
  userId: string,
  input: Omit<typeof outreachMessages.$inferInsert, "userId" | "id" | "createdAt" | "updatedAt">,
) {
  const [row] = await getDb()
    .insert(outreachMessages)
    .values({ ...input, userId })
    .returning();
  return row!;
}

export async function updateOutreach(
  userId: string,
  id: string,
  update: Partial<
    Pick<
      typeof outreachMessages.$inferSelect,
      "subject" | "body" | "recipientEmail" | "recipientName" | "status" | "sentAt"
    >
  >,
) {
  const [row] = await getDb()
    .update(outreachMessages)
    .set(update)
    .where(and(eq(outreachMessages.id, id), eq(outreachMessages.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("Message");
  return row;
}

export async function deleteOutreach(userId: string, id: string): Promise<void> {
  const deleted = await getDb()
    .delete(outreachMessages)
    .where(and(eq(outreachMessages.id, id), eq(outreachMessages.userId, userId)))
    .returning({ id: outreachMessages.id });
  if (deleted.length === 0) throw new NotFoundError("Message");
}
