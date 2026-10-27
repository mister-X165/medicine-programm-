import { describe, it, expect } from "vitest";
import { loginSchema, createConsentSchema } from "./validation";

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    const parsed = loginSchema.parse({ doctorCode: "dr-123", password: "secret123" });
    expect(parsed.doctorCode).toBe("dr-123");
  });

  it("rejects missing doctorCode", () => {
    expect(() => loginSchema.parse({ password: "secret123" })).toThrow();
  });

  it("rejects empty password", () => {
    expect(() => loginSchema.parse({ doctorCode: "dr-123", password: "" })).toThrow();
  });
});

describe("createConsentSchema", () => {
  it("accepts a valid consent (caseId optional in body)", () => {
    const parsed = createConsentSchema.parse({
      consentType: "ai_analysis",
      granted: true,
    });
    expect(parsed.granted).toBe(true);
  });

  it("rejects an invalid consent type", () => {
    expect(() =>
      createConsentSchema.parse({ consentType: "not_a_real_type", granted: true }),
    ).toThrow();
  });
});
