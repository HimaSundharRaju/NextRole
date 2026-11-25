import type { Role } from "@gettargetrole/db/schema";
import { describe, expect, it } from "vitest";
import { canActOnAccount } from "./care-rules";

describe("canActOnAccount", () => {
  const staff = (role: Role) => ({ id: "s", role });

  it("lets support act only on regular users, and nobody on themselves", () => {
    expect(canActOnAccount(staff("support"), { id: "u", role: "user" })).toBe(true);
    expect(canActOnAccount(staff("support"), { id: "u", role: "specialist" })).toBe(false);
    expect(canActOnAccount(staff("support"), { id: "u", role: "admin" })).toBe(false);
    expect(canActOnAccount(staff("admin"), { id: "u", role: "support" })).toBe(true);
    expect(canActOnAccount(staff("admin"), { id: "s", role: "admin" })).toBe(false);
  });

  it("gives no one else any power over accounts", () => {
    expect(canActOnAccount(staff("support"), { id: "u", role: "support" })).toBe(false);
    expect(canActOnAccount(staff("specialist"), { id: "u", role: "user" })).toBe(false);
    expect(canActOnAccount(staff("user"), { id: "u", role: "user" })).toBe(false);
  });
});
