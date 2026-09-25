"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { deleteOutreach, updateOutreach } from "@/server/data/outreach";

export const markOutreachSent = authedAction(z.object({ id: z.uuid() }), async ({ id }, user) => {
  await updateOutreach(user.id, id, { status: "sent", sentAt: new Date() });
  revalidatePath("/outreach");
  return null;
});

export const editOutreach = authedAction(
  z.object({
    id: z.uuid(),
    subject: z.string().max(300),
    body: z.string().min(1).max(10_000),
    recipientEmail: z.union([z.email(), z.literal("")]),
  }),
  async ({ id, ...update }, user) => {
    await updateOutreach(user.id, id, update);
    revalidatePath("/outreach");
    return null;
  },
);

export const removeOutreach = authedAction(z.object({ id: z.uuid() }), async ({ id }, user) => {
  await deleteOutreach(user.id, id);
  revalidatePath("/outreach");
  return null;
});
