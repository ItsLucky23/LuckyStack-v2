import { describe, it, expect, vi, beforeEach } from "vitest";

import type { PasswordPolicyConfig } from "@luckystack/core";

//? validatePassword reads `getProjectConfig().auth.passwordPolicy` at call
//? time. We mock @luckystack/core so the policy is fully test-controlled and
//? no real config/registry/infra is touched. Only the single slot the unit
//? under test reads is provided. The mock is typed to that slot so the
//? returned value is not `any`.
interface PolicySlot {
  auth: { passwordPolicy: PasswordPolicyConfig };
}

const getProjectConfigMock = vi.fn<() => PolicySlot>();

vi.mock("@luckystack/core", () => ({
  getProjectConfig: () => getProjectConfigMock(),
}));

import { validatePassword } from "./passwordPolicy";

//? A permissive baseline policy: long, no complexity requirements, common-list
//? off. Each test overrides only the field it exercises so the asserted
//? reason-key is unambiguously caused by that one branch.
const basePolicy: PasswordPolicyConfig = {
  minLength: 1,
  maxLength: 1000,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
  forbidCommon: false,
};

const setPolicy = (overrides: Partial<PasswordPolicyConfig>): void => {
  getProjectConfigMock.mockReturnValue({
    auth: { passwordPolicy: { ...basePolicy, ...overrides } },
  });
};

describe("validatePassword", () => {
  beforeEach(() => {
    getProjectConfigMock.mockReset();
  });

  it("returns null when every check passes under a permissive policy", () => {
    setPolicy({});
    expect(validatePassword("anything-goes")).toBeNull();
  });

  it("rejects passwords shorter than minLength", () => {
    setPolicy({ minLength: 8 });
    expect(validatePassword("short")).toBe("login.passwordCharacterMinimum");
  });

  it("accepts a password exactly at minLength (boundary)", () => {
    setPolicy({ minLength: 5 });
    expect(validatePassword("12345")).toBeNull();
  });

  it("rejects passwords longer than maxLength", () => {
    setPolicy({ maxLength: 4 });
    expect(validatePassword("12345")).toBe("login.passwordCharacterLimit");
  });

  it("accepts a password exactly at maxLength (boundary)", () => {
    setPolicy({ maxLength: 5 });
    expect(validatePassword("12345")).toBeNull();
  });

  it("requires an uppercase letter when requireUppercase is on", () => {
    setPolicy({ requireUppercase: true });
    expect(validatePassword("lowercase1!")).toBe("login.passwordRequiresUppercase");
    expect(validatePassword("Uppercase1!")).toBeNull();
  });

  it("requires a lowercase letter when requireLowercase is on", () => {
    setPolicy({ requireLowercase: true });
    expect(validatePassword("UPPER123!")).toBe("login.passwordRequiresLowercase");
    expect(validatePassword("UPPERlower")).toBeNull();
  });

  it("requires a digit when requireNumber is on", () => {
    setPolicy({ requireNumber: true });
    expect(validatePassword("NoDigitsHere")).toBe("login.passwordRequiresNumber");
    expect(validatePassword("HasDigit1")).toBeNull();
  });

  it("requires a special character when requireSpecial is on", () => {
    setPolicy({ requireSpecial: true });
    expect(validatePassword("Alnum123")).toBe("login.passwordRequiresSpecial");
    expect(validatePassword("Alnum123!")).toBeNull();
  });

  it("rejects a common password (case-insensitive) when forbidCommon is on", () => {
    setPolicy({ forbidCommon: true });
    expect(validatePassword("password")).toBe("login.passwordTooCommon");
    expect(validatePassword("PASSWORD")).toBe("login.passwordTooCommon");
  });

  it("allows a common password when forbidCommon is off", () => {
    setPolicy({ forbidCommon: false });
    expect(validatePassword("password")).toBeNull();
  });

  it("surfaces the reason returned by a custom validator", () => {
    const customValidator = vi.fn(() => "login.customReason");
    setPolicy({ customValidator });
    expect(validatePassword("Whatever1!")).toBe("login.customReason");
    expect(customValidator).toHaveBeenCalledWith("Whatever1!");
  });

  it("passes when the custom validator returns null", () => {
    const customValidator = vi.fn(() => null);
    setPolicy({ customValidator });
    expect(validatePassword("Whatever1!")).toBeNull();
    expect(customValidator).toHaveBeenCalledOnce();
  });

  it("checks built-in rules before the custom validator (length wins first)", () => {
    const customValidator = vi.fn(() => "login.customReason");
    setPolicy({ minLength: 100, customValidator });
    expect(validatePassword("short")).toBe("login.passwordCharacterMinimum");
    expect(customValidator).not.toHaveBeenCalled();
  });

  it("rejects passwords over 72 utf8-encoded bytes (bcrypt truncation cap)", () => {
    // 73 ASCII chars = 73 bytes — one over the bcrypt silent-truncation boundary.
    setPolicy({ maxLength: 1000 });
    expect(validatePassword("a".repeat(73))).toBe("login.passwordCharacterLimit");
  });

  it("accepts a password exactly at the 72-byte bcrypt boundary", () => {
    setPolicy({ maxLength: 1000 });
    expect(validatePassword("a".repeat(72))).toBeNull();
  });
});
