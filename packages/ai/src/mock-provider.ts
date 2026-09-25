import { SAMPLE_RESUME } from "@gettargetrole/resume/fixtures";
import { normalizeResume, type Resume } from "@gettargetrole/resume/schema";
import { findSkills } from "@gettargetrole/resume/skills";
import { resumeToPlainText } from "@gettargetrole/resume/text";
import type { AiFeature } from "./config";
import type { AiCallContext, AiProvider, ResumeSource, StudioEvent } from "./types";

/**
 * Deterministic stand-in for Claude used by automated tests and keyless local development.
 * It is rejected at startup in production (see @gettargetrole/core env validation).
 */

async function meter(feature: AiFeature, ctx: AiCallContext): Promise<void> {
  await ctx.onUsage?.({
    feature,
    model: "mock",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costMicroUsd: 0,
  });
}

function clone(resume: Resume): Resume {
  return structuredClone(resume);
}

function parseTextResume(text: string): Resume {
  const resume = clone(SAMPLE_RESUME);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const email = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(text)?.[0];
  const phone = /\+?\d[\d\s().-]{7,}\d/.exec(text)?.[0];
  if (lines[0] && lines[0].length < 60) resume.basics.name = lines[0];
  if (email) resume.basics.email = email;
  if (phone) resume.basics.phone = phone.trim();
  return resume;
}

function skillsFirst(resume: Resume, wanted: string[]): Resume {
  const wantedSet = new Set(wanted);
  const rank = (item: string) => (findSkills(item).some((skill) => wantedSet.has(skill)) ? 0 : 1);
  return {
    ...resume,
    skills: resume.skills.map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => rank(a) - rank(b)),
    })),
  };
}

export class MockProvider implements AiProvider {
  readonly name = "mock" as const;
  readonly model = "mock";

  async importResume(source: ResumeSource, ctx: AiCallContext) {
    await meter("import", ctx);
    const resume = source.kind === "text" ? parseTextResume(source.text) : clone(SAMPLE_RESUME);
    return { resume: normalizeResume(resume), notes: [] };
  }

  async generateResume(input: Parameters<AiProvider["generateResume"]>[0], ctx: AiCallContext) {
    await meter("generate", ctx);
    const resume = clone(SAMPLE_RESUME);
    resume.basics.headline = input.targetRole;
    return {
      resume,
      suggestions: ["Add the number of users your main project served."],
    };
  }

  async tailorResume(input: Parameters<AiProvider["tailorResume"]>[0], ctx: AiCallContext) {
    await meter("tailor", ctx);
    const wanted = findSkills(input.job.description);
    const have = new Set(findSkills(resumeToPlainText(input.resume)));
    const resume = skillsFirst(clone(input.resume), wanted);
    resume.basics.headline = input.job.title;
    return {
      resume: normalizeResume(resume),
      summaryOfChanges: [
        `Retitled the headline to "${input.job.title}".`,
        "Moved the skills this job asks for to the front of each group.",
      ],
      addedKeywords: [],
      missingKeywords: wanted.filter((skill) => !have.has(skill)),
      suggestions: ["Quantify the impact of your most recent project."],
    };
  }

  async analyzeFit(input: Parameters<AiProvider["analyzeFit"]>[0], ctx: AiCallContext) {
    await meter("match", ctx);
    const wanted = findSkills(input.job.description);
    const have = new Set(findSkills(resumeToPlainText(input.resume)));
    const matched = wanted.filter((skill) => have.has(skill));
    const score = wanted.length ? Math.round((matched.length / wanted.length) * 100) : 60;
    const verdict =
      score >= 80 ? "strong" : score >= 65 ? "good" : score >= 50 ? "stretch" : "poor";
    return {
      score,
      verdict: verdict as "strong" | "good" | "stretch" | "poor",
      summary: `You match ${matched.length} of ${wanted.length} skills this role lists.`,
      strengths: matched.slice(0, 4).map((skill) => `Shows ${skill} experience on the resume.`),
      gaps: wanted
        .filter((skill) => !have.has(skill))
        .slice(0, 4)
        .map((skill) => `No evidence of ${skill}.`),
      recommendation: score >= 65 ? "Apply now." : "Tailor your resume before applying.",
    };
  }

  async writeCoverLetter(input: Parameters<AiProvider["writeCoverLetter"]>[0], ctx: AiCallContext) {
    await meter("cover_letter", ctx);
    const name = input.resume.basics.name || "Candidate";
    const highlight = input.resume.experience[0]?.highlights[0] ?? "delivered measurable results";
    return {
      subject: `Application: ${input.job.title}`,
      body: `Dear ${input.recipientName || "Hiring Team"},\n\nI'm applying for the ${input.job.title} role at ${input.job.company}. Most recently I ${highlight.charAt(0).toLowerCase()}${highlight.slice(1)}\n\nI'd welcome the chance to discuss how I can help your team.\n\nBest regards,\n${name}`,
    };
  }

  async answerQuestions(input: Parameters<AiProvider["answerQuestions"]>[0], ctx: AiCallContext) {
    await meter("answers", ctx);
    return {
      answers: input.questions.map((question) => ({
        question,
        answer: /authori[sz]|sponsor|visa/i.test(question)
          ? input.profile?.workAuthorization || "[Please fill in: your work authorization status]"
          : `I'm excited about the ${input.job.title} role at ${input.job.company} because it matches my recent work.`,
      })),
    };
  }

  async draftOutreach(input: Parameters<AiProvider["draftOutreach"]>[0], ctx: AiCallContext) {
    await meter("outreach", ctx);
    const first = input.recipient?.name?.split(" ")[0];
    const name = input.resume.basics.name || "Candidate";
    return {
      email: {
        subject: `${input.job.title} — ${name}`,
        body: `${first ? `Hi ${first}` : "Hi there"},\n\nI just applied for the ${input.job.title} role at ${input.job.company}. Would you be open to a 15-minute chat?\n\nThanks,\n${name}`,
      },
      linkedinNote: `Hi${first ? ` ${first}` : ""}, I applied for the ${input.job.title} role at ${input.job.company} and would love to connect.`,
      followUp: {
        subject: `Following up: ${input.job.title}`,
        body: `Hi${first ? ` ${first}` : ""}, following up on my note about the ${input.job.title} role. Happy to share more.\n\n${name}`,
      },
    };
  }

  async prepareInterview(input: Parameters<AiProvider["prepareInterview"]>[0], ctx: AiCallContext) {
    await meter("interview", ctx);
    return {
      questions: [
        {
          category: "behavioral" as const,
          question: "Tell me about a project you're proud of.",
          whyTheyAsk: "To understand your impact and ownership.",
          answerOutline: `Use a STAR story from your time at ${input.resume.experience[0]?.company ?? "your last role"}.`,
        },
        {
          category: "motivation" as const,
          question: `Why do you want to work at ${input.job.company}?`,
          whyTheyAsk: "To check genuine interest in the role.",
          answerOutline: "Connect the team's mission to your recent work.",
        },
      ],
      questionsToAsk: ["What does success look like in the first 90 days?"],
    };
  }

  async *studioChat(
    input: Parameters<AiProvider["studioChat"]>[0],
    ctx: AiCallContext,
  ): AsyncGenerator<StudioEvent> {
    await meter("studio", ctx);
    const wantsSummary = /summary/i.test(input.message);
    const reply = wantsSummary
      ? "I tightened your summary to lead with your strongest result."
      : "Here's my feedback: lead each bullet with an action verb and a measurable result.";
    for (const word of reply.split(/(?<= )/)) {
      yield { type: "text", text: word };
    }
    if (wantsSummary) {
      const resume = clone(input.resume);
      const firstBullet = resume.experience[0]?.highlights[0];
      resume.summary = firstBullet
        ? `${resume.basics.headline || "Professional"} who ${firstBullet.charAt(0).toLowerCase()}${firstBullet.slice(1)}`
        : resume.summary;
      yield { type: "resume", resume: normalizeResume(resume), summary: "Rewrote the summary" };
      yield { type: "done", reply, changed: true };
      return;
    }
    yield { type: "done", reply, changed: false };
  }
}
