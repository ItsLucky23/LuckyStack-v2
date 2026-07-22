import { describe, it, expect } from "vitest";

//? redirectResolver.ts has no external imports — it is a pure registry module.
//? The CORS/allowed-origins VALIDATION of a resolved URL lives in login.ts's
//? non-exported `isAllowedRedirectUrl` (reachable only via the infra-heavy
//? `loginCallback`), so it is out of scope for a no-infrastructure unit test.
//? Here we cover the registry surface that IS purely testable.
import {
  registerPostLoginRedirect,
  getPostLoginRedirect,
  resolvePostLoginRedirectAgainstDefault,
  type PostLoginRedirectInput,
} from "./redirectResolver";

const sampleInput: PostLoginRedirectInput = {
  userId: "u1",
  provider: "google",
  isNewUser: true,
  defaultUrl: "/dashboard",
};

const passthroughResolver = (input: PostLoginRedirectInput): string => input.defaultUrl;
const onboardingResolver = (input: PostLoginRedirectInput): string =>
  input.isNewUser ? "/onboarding" : input.defaultUrl;
const tenantResolver = (input: PostLoginRedirectInput): Promise<string> =>
  Promise.resolve(`/tenant/${input.userId}`);
const firstResolver = (): string => "/first";
const secondResolver = (): string => "/second";

describe("post-login redirect resolver registry", () => {
  //? NOTE: ordering matters. The "returns null" assertion runs first, before
  //? any register call mutates the module-level resolver slot. There is no
  //? public un-register, so subsequent tests build on the registered state.
  it("returns null before any resolver is registered", () => {
    expect(getPostLoginRedirect()).toBeNull();
  });

  it("registerPostLoginRedirect stores the resolver and returns it", () => {
    const returned = registerPostLoginRedirect(passthroughResolver);
    expect(returned).toBe(passthroughResolver);
    expect(getPostLoginRedirect()).toBe(passthroughResolver);
  });

  it("a registered resolver computes a URL from its input", async () => {
    registerPostLoginRedirect(onboardingResolver);
    const active = getPostLoginRedirect();
    expect(active).not.toBeNull();
    expect(await active?.(sampleInput)).toBe("/onboarding");
    expect(await active?.({ ...sampleInput, isNewUser: false })).toBe("/dashboard");
  });

  it("supports async resolvers", async () => {
    registerPostLoginRedirect(tenantResolver);
    expect(await getPostLoginRedirect()?.(sampleInput)).toBe("/tenant/u1");
  });

  it("last registration wins", () => {
    registerPostLoginRedirect(firstResolver);
    registerPostLoginRedirect(secondResolver);
    expect(getPostLoginRedirect()).toBe(secondResolver);
  });
});

describe("resolvePostLoginRedirectAgainstDefault", () => {
  it("anchors a root-relative resolver result on the frontend default origin", () => {
    expect(
      resolvePostLoginRedirectAgainstDefault(
        "/onboarding?welcome=1#profile",
        "https://app.example.com/dashboard",
      ),
    ).toBe("https://app.example.com/onboarding?welcome=1#profile");
  });

  it("preserves an allowed absolute resolver result", () => {
    expect(
      resolvePostLoginRedirectAgainstDefault(
        "https://tenant.example.com/home",
        "https://app.example.com/dashboard",
      ),
    ).toBe("https://tenant.example.com/home");
  });

  it("keeps backwards compatibility when a direct caller supplied only a relative default", () => {
    expect(resolvePostLoginRedirectAgainstDefault("/onboarding", "/dashboard")).toBe("/onboarding");
  });
});
