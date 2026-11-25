import { describe, expect, it } from "vitest";
import { explainVisaSignals, parseVisaSignals } from "./visa";

/*
 * Wording is copied from postings in the local dev database (the employer is in the comment),
 * trimmed to the sentences that decide the label. Lines marked "synthetic" are not from a posting.
 */

describe("posts restricted to citizens, permanent residents or U.S. persons", () => {
  it.each([
    // The plural "citizens" and a dotted "U.S." used to slip through.
    [
      "Due to requirements associated with work this role may support, applicants for this position must be U.S. citizens.",
    ], // OpenAI
    [
      "To comply with a U.S. government contract, applicants for this position must be U.S. citizens with the ability to obtain and maintain a Tier 4 (High Risk Public Trust) background investigation.",
    ], // OpenAI
    [
      "To comply with a U.S. government contract, applicants for this position must be U.S. citizens, U.S. nationals, or U.S. persons (i.e., U.S. lawful permanent residents, refugees, and asylees).",
    ], // OpenAI
    [
      "Important Eligibility Requirement: Due to contractual requirements supporting U.S. Public Sector customers, this position requires U.S. citizenship. Candidates who are not U.S. citizens are not eligible for consideration.",
    ], // Databricks
    [
      "Position Restriction: This position is restricted to US citizens or lawful permanent residents",
    ], // Robinhood
    ["This position requires U.S. citizenship or U.S. permanent resident (green card) status"], // Robinhood
    [
      "Eligibility as a United States Person (U.S. citizen, lawful permanent resident, refugee, or asylee), in line with government requirements for this role.",
    ], // GitLab
    [
      "Our FedRAMP program requires that anyone who is accessing customer data or metadata inside the Authorization Boundary be a US Citizen on US Soil.",
    ], // MongoDB
    ["Special Requirements:\n• Be a US Citizen\nExpectations"], // MongoDB
    [
      "• Are a US person. We have agreements with the US Government that mandate this for these roles.",
    ], // Anthropic
    [
      "• Must be eligible to access and work with US export-controlled and restricted materials, including ITAR, EAR, OFAC, and CUI.",
    ], // Palantir
    [
      "• Eligibility to access International Traffic in Arms Regulation (ITAR), Export Administration Regulation (EAR), Office of Foreign Assets Control (OFAC), and Controlled Unclassified Information (CUI) materials",
    ], // Palantir
    ["• Must be a US citizen or green card holder"], // Palantir, read correctly before too
    [
      "Due to federal contract requirements and client site access obligations, U.S. citizenship is required to access classified information.",
    ], // Databricks
    [
      "• U.S. citizenship required (program operates in classified and government-sensitive environments).",
    ], // Palantir
    ["Candidates who are not U.S. citizens are not eligible for consideration."], // Databricks
    ["Candidates must be U.S. citizens, permanent residents, asylees or refugees."], // the test report's wording; not in the dev DB
    ["This position is open to U.S. citizens, permanent residents, asylees or refugees."], // synthetic: a list of statuses, with no "must"
    [
      "To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder), (iii) Refugee under 8 U.S.C. § 1157, or (iv) Asylee under 8 U.S.C. § 1158, or be eligible to obtain the required authorizations from the U.S. Department of State.",
    ], // synthetic: the usual ITAR wording, listing statuses with numbering in between
    ["Applicants must be a citizen of the United States."], // synthetic
    ["Only U.S. citizens will be considered for this role."], // synthetic
    ["Candidates must have eligibility as a U.S. Person."], // synthetic
    [
      "• Active US Security clearance or eligibility and willingness to obtain a US Security clearance.",
    ], // Palantir: clearances count, as before
  ])("flags %j", (text) => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship: "unknown", citizenshipRequired: true });
  });

  it.each([
    [
      "To comply with U.S. export control laws and regulations, candidates for this role may need to meet certain legal status requirements as provided in those laws and regulations.",
    ], // OpenAI: "may need" is not a requirement
    [
      "Palantir is particularly interested in applicants who have a current right to work in Singapore, and we encourage Singapore citizens to apply.",
    ], // Palantir
    [
      "Figma is an equal opportunity workplace - we are dedicated to equal employment opportunities regardless of race, color, ancestry, religion, sex, national origin, sexual orientation, age, citizenship, marital status, disability, gender identity",
    ], // Figma
    [
      "• Use a solution‑oriented, value‑based sales approach that links Databricks to measurable outcomes for public services and citizens.",
    ], // Databricks
    [
      "Our customers come to us with a hunch that the only way to protect their troops, manufacture high-quality products, structure effective healthcare policies, or deliver aid to refugees safely is to make better use of their data.",
    ], // Palantir
    [
      "• Triage and respond to potential export control incidents and sanctions issues, including adjudicating foreign national access to ITAR-controlled data and employee access to such data during international travel.",
    ], // Palantir: a duty, not a requirement of the candidate
    [
      "• Manage a high-volume immigration case portfolio - including permanent residence processes (PERM, I-140, AOS, ILR) — across US, EMEA, JAPAC, and LATAM",
    ], // Figma
    ["US security clearance (preferred but not required)"], // Anthropic
    ["Candidates do not need to be U.S. citizens."], // synthetic
    ["Candidates need not be U.S. citizens."], // synthetic
    ["There is no need to be a U.S. citizen."], // synthetic
    ["We do not require U.S. citizenship."], // synthetic
    ["This role is not restricted to U.S. citizens."], // synthetic
    ["We hire regardless of whether candidates are citizens, permanent residents or refugees."], // synthetic
    [
      "Candidates are considered whether or not they are citizens, permanent residents or refugees.",
    ], // synthetic
    ["You must be a U.S. citizen or hold valid work authorization."], // synthetic: work authorization qualifies too
    ["We help employees who are citizens, permanent residents or refugees with relocation."], // synthetic: lists statuses, restricts nobody
  ])("does not flag %j", (text) => {
    expect(parseVisaSignals(text).citizenshipRequired).toBe(false);
  });

  it.each([
    [
      "• Active US Security clearance, or eligibility and willingness to obtain a US Security clearance is beneficial, but not necessary.",
    ], // Palantir
    ["• Active clearance a plus, but not required"], // Palantir
    ["An active security clearance is a plus."], // synthetic
    ["An active security clearance is beneficial."], // synthetic
    ["An active security clearance is not required."], // synthetic
    ["An active clearance is nice to have."], // synthetic
    ["An active clearance is a bonus."], // synthetic
  ])("does not flag a clearance the post calls optional: %j", (text) => {
    expect(parseVisaSignals(text).citizenshipRequired).toBe(false);
  });
});

describe("what a post says about sponsoring visas", () => {
  it.each([
    ["Fluency in Mandarin and English is required. Visa sponsorship is not available."], // Airbnb
    [
      "To the attention of candidates in Colombia: Visa sponsorship is NOT provided for this position.",
    ], // Cloudflare
    [
      "(please note we don't sponsor work visa or relocations, you already need to be based in the Bay Area).",
    ], // Supabase
    [
      "This role does not include employment sponsorship or relocation assistance to Singapore. Candidates must already have the legal right to work in Singapore",
    ], // MongoDB
    [
      "Visa Sponsorship: We are not currently able to sponsor visas for fellows. To participate in the Fellows program, you need to have or independently obtain full-time work authorization in the UK, the US, or Canada.",
    ], // Anthropic
    [
      "This role is based in Milan (hybrid, 2 days a week in the office), and is not eligible for visa or relocation support.",
    ], // Airbnb
    ["We will not sponsor visas for this role."], // synthetic
    ["Unfortunately we are unable to sponsor visas for this role."], // synthetic
    ["No visa sponsorship is available for this role."], // synthetic
  ])("reads a refusal in %j", (text) => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship: "no", citizenshipRequired: false });
  });

  it.each([
    [
      "Visa sponsorship: We do sponsor visas! However, we aren't able to successfully sponsor visas for every role and every candidate. But if we make you an offer, we will make every reasonable effort to get you a visa, and we retain an immigration lawyer to help with this.",
    ], // Anthropic: a hedge ("not every role") is not a refusal
    ["We will sponsor visas for the right candidate."], // synthetic
    ["We sponsor H-1B visas."], // synthetic
    ["We sponsor H1-B visas for qualified candidates."], // synthetic
    ["Visa sponsorship is available for this position."], // synthetic
    ["Visa sponsorship: Yes"], // synthetic
    ["H-1B transfers are welcome."], // synthetic
    ["Visa sponsorship may be offered for the right candidate."], // synthetic
    ["We offer visa sponsorship for qualified candidates."], // synthetic
    ["Sponsorship available for the right candidate."], // synthetic
  ])("reads an offer in %j", (text) => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship: "yes", citizenshipRequired: false });
  });

  it.each([
    ["We will sponsor you for relocation if you need to move for this role."], // Ramp: relocation, not a visa
    [
      "Shape Ramp’s immigration strategy—including what we sponsor, how we approach edge cases, and where we take risk—and drive decisions with leadership",
    ], // Ramp: an immigration role, not an offer
    [
      "In this role you will serve as a primary point of contact for visa-sponsored Figmates, managing immigration cases and compliance while providing a high-touch employee experience.",
    ], // Figma
    [
      "• Partner with People Partners and Talent Acquisition to assess immigration sponsorship feasibility for new hires and internal transfers",
    ], // Figma
    ["• 100% employer-sponsored group medical plan"], // Reddit
    [
      "• Familiarity with card network protocols, BIN sponsorship models, or issuing bank integrations (Visa, Mastercard, or equivalent).",
    ], // Stripe: Visa the card network
    [
      "Please note that any offer of employment may be conditioned on your authorization to receive software or technology controlled under these U.S. export laws without sponsorship for an export license.",
    ], // Cloudflare: an export license, not a visa (394 posts were read as "no" because of this)
    ["We aren't able to successfully sponsor visas for every role and every candidate."], // Anthropic: partial, so not a "no"
    ["Visa sponsorship is available in the UK. Visa sponsorship is not available in the US."], // synthetic: says both
  ])("leaves %j unknown", (text) => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship: "unknown", citizenshipRequired: false });
  });
});

describe("a post that offers sponsorship but restricts the role", () => {
  // Anthropic's public-sector posts carry the company's visa paragraph and also need a U.S. person.
  const text =
    "• Are a US person. We have agreements with the US Government that mandate this for these roles.\n\nVisa sponsorship: We do sponsor visas! However, we aren't able to successfully sponsor visas for every role and every candidate.";

  it("is not labelled as sponsoring: the 'Says it sponsors visas' filter would show a role they can't take", () => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship: "unknown", citizenshipRequired: true });
  });

  it("keeps the citizenship evidence and records no sponsorship evidence", () => {
    expect(explainVisaSignals(text).evidence).toEqual({
      sponsorship: null,
      citizenship: "Are a US person.",
    });
  });
});

describe("explainVisaSignals", () => {
  it("returns the sentence that decided each label", () => {
    const text =
      "Fluency in Mandarin and English is required. Visa sponsorship is not available.\n• Be a US Citizen";
    expect(explainVisaSignals(text)).toEqual({
      sponsorship: "no",
      citizenshipRequired: true,
      evidence: {
        sponsorship: "Visa sponsorship is not available.",
        citizenship: "Be a US Citizen",
      },
    });
  });

  it("keeps a sentence together across a dotted U.S.", () => {
    const sentence =
      "Due to requirements associated with work this role may support, applicants for this position must be U.S. citizens.";
    expect(explainVisaSignals(`Intro text. ${sentence} More text.`).evidence.citizenship).toBe(
      sentence,
    );
  });

  it("quotes the offer, not the hedge that follows it", () => {
    const text =
      "Visa sponsorship: We do sponsor visas! However, we aren't able to successfully sponsor visas for every role and every candidate.";
    expect(explainVisaSignals(text).evidence.sponsorship).toBe(
      "Visa sponsorship: We do sponsor visas!",
    );
  });

  it("has no evidence when nothing decided a label", () => {
    expect(explainVisaSignals("We sponsor hackathons and community meetups.")).toEqual({
      sponsorship: "unknown",
      citizenshipRequired: false,
      evidence: { sponsorship: null, citizenship: null },
    });
  });

  it("has no sponsorship evidence when the post contradicts itself", () => {
    const text = "We sponsor visas in the UK, but we cannot sponsor for US roles.";
    expect(explainVisaSignals(text).evidence.sponsorship).toBeNull();
  });

  it("agrees with parseVisaSignals", () => {
    const text =
      "Position Restriction: This position is restricted to US citizens or lawful permanent residents";
    const { evidence, ...labels } = explainVisaSignals(text);
    expect(labels).toEqual(parseVisaSignals(text));
    expect(evidence.citizenship).toBe(text);
  });
});
