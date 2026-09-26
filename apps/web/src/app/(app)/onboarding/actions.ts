"use server";

import { z } from "zod";
import { authedAction } from "@/server/action";
import { aiFor } from "@/server/ai";
import { candidateProfile } from "@/server/data/profile";
import { createResume } from "@/server/data/resumes";

export const generateResume = authedAction(
  z.object({
    targetRole: z.string().trim().min(2, "Tell us the role you're aiming for").max(120),
    background: z
      .string()
      .trim()
      .min(80, "Add a few sentences about your experience so the AI has something to work with")
      .max(20_000),
  }),
  async (input, user) => {
    const { ai, ctx, charge } = await aiFor(user, "import");
    const result = await ai.generateResume(
      { ...input, profile: await candidateProfile(user.id) },
      ctx,
    );
    const resume = await createResume(user.id, {
      title: `${input.targetRole} resume`,
      content: result.resume,
      source: "ai_generate",
      note: "Generated with AI",
      makePrimary: true,
    });
    await charge(resume.id);
    return { id: resume.id, suggestions: result.suggestions };
  },
  { rateLimit: "aiHeavy" },
);
