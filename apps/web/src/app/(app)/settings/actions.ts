"use server";

import { ValidationError } from "@gettargetrole/core/errors";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aboutSchema, preferencesSchema } from "@/lib/validation";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { deleteUserAccount } from "@/server/data/account";
import { markOnboarded, updateProfile } from "@/server/data/profile";

export const savePreferences = authedAction(preferencesSchema, async (input, user) => {
  const { completeOnboarding, ...preferences } = input;
  await updateProfile(user.id, preferences);
  if (completeOnboarding) await markOnboarded(user.id);
  revalidatePath("/", "layout");
  return null;
});

export const saveAbout = authedAction(aboutSchema, async (input, user) => {
  await updateProfile(user.id, input);
  revalidatePath("/settings");
  return null;
});

export const deleteAccount = authedAction(
  z.object({ confirmation: z.string() }),
  async ({ confirmation }, user) => {
    if (confirmation !== "DELETE") throw new ValidationError("Type DELETE to confirm.");
    await recordAudit({
      actorUserId: null,
      action: "account.delete",
      targetType: "user",
      targetId: user.id,
    });
    await deleteUserAccount(user.id);
    return null;
  },
);
