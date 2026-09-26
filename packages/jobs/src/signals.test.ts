import { describe, expect, it } from "vitest";
import { parseEmploymentTypes } from "./employment";
import { countryLabel, parseLocations, regionLabel } from "./locations";
import { parseVisaSignals } from "./visa";

describe("parseLocations", () => {
  it.each([
    ["San Francisco, CA", ["US"], ["US-CA"]],
    ["Dublin, CA", ["US"], ["US-CA"]],
    ["London, ON", ["CA"], ["CA-ON"]],
    ["Perth, WA", ["AU"], ["AU-WA"]],
    ["Seattle, Washington", ["US"], ["US-WA"]],
    ["Portland, OR", ["US"], ["US-OR"]],
    ["Bengaluru, Karnataka, India", ["IN"], ["IN-KA"]],
    ["Remote - US", ["US"], []],
    ["Remote (Canada)", ["CA"], []],
    ["Dublin", ["IE"], []],
    ["London, UK", ["GB"], []],
    ["SEA, SF, NYC, CHI", ["US"], ["US-CA", "US-IL", "US-NY", "US-WA"]],
    ["Dublin OR London", ["GB", "IE"], []],
    ["Remote", [], []],
  ])("places %s", (text, countries, regions) => {
    expect(parseLocations([text])).toEqual({ countries, regions });
  });

  it("prefers structured hints from the job board", () => {
    expect(
      parseLocations(
        [],
        [{ country: "United States", region: "California", city: "San Francisco" }],
      ),
    ).toEqual({ countries: ["US"], regions: ["US-CA"] });
    expect(parseLocations([], [{ country: "sg" }])).toEqual({ countries: ["SG"], regions: [] });
  });

  it("labels codes for display", () => {
    expect(countryLabel("GB")).toBe("United Kingdom");
    expect(regionLabel("US-TX")).toBe("Texas");
  });
});

describe("parseEmploymentTypes", () => {
  it("reads the board's type and the title", () => {
    expect(parseEmploymentTypes("Internship", "Software Engineering Intern", "")).toEqual([
      "internship",
    ]);
    expect(parseEmploymentTypes("Contractor", "Data Engineer", "")).toEqual(["contract"]);
    expect(parseEmploymentTypes("", "Senior Backend Engineer", "Build APIs.")).toEqual([
      "full_time",
    ]);
  });

  it("adds W-2, C2C and 1099 only when the post offers them", () => {
    expect(parseEmploymentTypes("", "Java Developer", "Open to W2 or C2C candidates.")).toEqual([
      "contract",
      "w2",
      "c2c",
    ]);
    expect(parseEmploymentTypes("Contract", "Java Developer", "W2 only, no C2C.")).toEqual([
      "contract",
      "w2",
    ]);
    expect(
      parseEmploymentTypes("", "Payroll Specialist", "Prepare W-2 forms each January."),
    ).toEqual(["full_time"]);
  });
});

describe("parseVisaSignals", () => {
  it.each([
    ["We are unable to sponsor visas for this role.", "no", false],
    [
      "You must be authorized to work in the U.S. without sponsorship now or in the future.",
      "no",
      false,
    ],
    ["• U.S. Person Required", "no", false],
    ["Visa sponsorship is available for this position.", "yes", false],
    ["We sponsor hackathons and community meetups.", "unknown", false],
    ["You will advise teams on ITAR and EAR compliance.", "unknown", false],
    ["We sponsor visas in the UK, but we cannot sponsor for US roles.", "unknown", false],
    ["An active TS/SCI clearance is required.", "unknown", true],
    ["A security clearance is a plus but not required.", "unknown", false],
  ] as const)("reads %j", (text, sponsorship, citizenshipRequired) => {
    expect(parseVisaSignals(text)).toEqual({ sponsorship, citizenshipRequired });
  });
});
