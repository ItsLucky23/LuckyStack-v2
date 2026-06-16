import { describe, it, expect, beforeEach, vi } from "vitest";

//? oauthProviders.ts imports `tryCatch` from @luckystack/core (used only inside
//? the github/microsoft network accessors, which these tests do not exercise).
//? Mock it so importing the module needs no real core runtime.
vi.mock("@luckystack/core", () => ({
  tryCatch: vi.fn(),
}));

import {
  asOAuthUserData,
  isFullOAuthProvider,
  credentialsProvider,
  googleProvider,
  githubProvider,
  discordProvider,
  facebookProvider,
  microsoftProvider,
  getOAuthProviders,
  registerOAuthProviders,
  type FullOAuthProvider,
} from "./oauthProviders";

const extraSessionFields: FullOAuthProvider["extraSessionFields"] = () => ({ team: "x" });

describe("asOAuthUserData", () => {
  it("returns the object unchanged when given a plain object", () => {
    const input = { id: "abc", name: "Ada" };
    expect(asOAuthUserData(input)).toBe(input);
  });

  it("returns an empty object for null", () => {
    expect(asOAuthUserData(null)).toEqual({});
  });

  it("returns an empty object for primitives", () => {
    expect(asOAuthUserData("string")).toEqual({});
    expect(asOAuthUserData(42)).toEqual({});
    expect(asOAuthUserData(true)).toEqual({});
  });

  it("treats arrays as objects (typeof array === 'object')", () => {
    const arr = ["a", "b"];
    expect(asOAuthUserData(arr)).toBe(arr);
  });
});

describe("isFullOAuthProvider", () => {
  it("returns false for the credentials provider", () => {
    expect(isFullOAuthProvider(credentialsProvider())).toBe(false);
  });

  it("returns true for a full OAuth provider", () => {
    const provider = googleProvider({
      clientId: "id",
      clientSecret: "secret",
      callbackUrl: "https://app.test/auth/callback/google",
    });
    expect(isFullOAuthProvider(provider)).toBe(true);
  });
});

describe("credentialsProvider", () => {
  it("returns the credentials sentinel", () => {
    expect(credentialsProvider()).toEqual({ name: "credentials" });
  });
});

describe("OAuth provider factories", () => {
  const baseInput = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "https://app.test/auth/callback/x",
  };

  it("googleProvider populates defaults and keys", () => {
    const p = googleProvider(baseInput);
    expect(p.name).toBe("google");
    expect(p.clientID).toBe("client-id");
    expect(p.clientSecret).toBe("client-secret");
    expect(p.callbackURL).toBe(baseInput.callbackUrl);
    expect(p.authorizationURL).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.tokenExchangeURL).toBe("https://oauth2.googleapis.com/token");
    expect(p.tokenExchangeMethod).toBe("json");
    expect(p.userInfoURL).toBe("https://www.googleapis.com/oauth2/v3/userinfo");
    expect(p.nameKey).toBe("name");
    expect(p.emailKey).toBe("email");
    expect(p.avatarKey).toBe("picture");
    expect(p.scope).toEqual([
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("githubProvider uses form-less json exchange and read:user scopes", () => {
    const p = githubProvider(baseInput);
    expect(p.name).toBe("github");
    expect(p.tokenExchangeMethod).toBe("json");
    expect(p.scope).toEqual(["read:user", "user:email"]);
    expect(p.nameKey).toBe("login");
    expect(typeof p.getEmail).toBe("function");
  });

  it("discordProvider uses form exchange and identify/email scopes", () => {
    const p = discordProvider(baseInput);
    expect(p.name).toBe("discord");
    expect(p.tokenExchangeMethod).toBe("form");
    expect(p.scope).toEqual(["identify", "email"]);
    expect(p.avatarCodeKey).toBe("avatar");
    expect(typeof p.getAvatar).toBe("function");
  });

  it("discordProvider getAvatar builds a CDN url for a png avatar", async () => {
    const p = discordProvider(baseInput);
    const url = await p.getAvatar?.({
      userData: { id: "123" },
      avatarId: "abcdef",
      accessToken: "tok",
    });
    expect(url).toBe("https://cdn.discordapp.com/avatars/123/abcdef.png");
  });

  it("discordProvider getAvatar uses gif for animated avatars (a_ prefix)", async () => {
    const p = discordProvider(baseInput);
    const url = await p.getAvatar?.({
      userData: { id: "123" },
      avatarId: "a_abcdef",
      accessToken: "tok",
    });
    expect(url).toBe("https://cdn.discordapp.com/avatars/123/a_abcdef.gif");
  });

  it("discordProvider getAvatar returns undefined without an avatarId or user id", async () => {
    const p = discordProvider(baseInput);
    expect(await p.getAvatar?.({ userData: { id: "123" }, accessToken: "tok" })).toBeUndefined();
    expect(await p.getAvatar?.({ userData: {}, avatarId: "abc", accessToken: "tok" })).toBeUndefined();
  });

  it("facebookProvider interpolates the default api version into urls", () => {
    const p = facebookProvider(baseInput);
    expect(p.name).toBe("facebook");
    expect(p.tokenExchangeMethod).toBe("form");
    expect(p.authorizationURL).toBe("https://www.facebook.com/v18.0/dialog/oauth");
    expect(p.tokenExchangeURL).toBe("https://graph.facebook.com/v18.0/oauth/access_token");
  });

  it("facebookProvider honours a custom apiVersion", () => {
    const p = facebookProvider({ ...baseInput, apiVersion: "v20.0" });
    expect(p.authorizationURL).toBe("https://www.facebook.com/v20.0/dialog/oauth");
    expect(p.tokenExchangeURL).toBe("https://graph.facebook.com/v20.0/oauth/access_token");
  });

  it("facebookProvider getAvatar extracts the nested picture data url", () => {
    const p = facebookProvider(baseInput);
    const url = p.getAvatar?.({
      userData: { picture: { data: { url: "https://cdn.fb/pic.jpg" } } },
      accessToken: "tok",
    });
    expect(url).toBe("https://cdn.fb/pic.jpg");
  });

  it("facebookProvider getAvatar returns undefined when picture data is missing", () => {
    const p = facebookProvider(baseInput);
    expect(p.getAvatar?.({ userData: {}, accessToken: "tok" })).toBeUndefined();
  });

  it("microsoftProvider uses the default common tenant and versions", () => {
    const p = microsoftProvider(baseInput);
    expect(p.name).toBe("microsoft");
    expect(p.authorizationURL).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(p.userInfoURL).toBe("https://graph.microsoft.com/v1.0/me");
    expect(p.scope).toEqual(["openid", "profile", "email", "User.Read"]);
  });

  it("microsoftProvider interpolates a custom tenant + versions", () => {
    const p = microsoftProvider({
      ...baseInput,
      tenant: "my-tenant",
      apiVersion: "v2.1",
      graphApiVersion: "beta",
    });
    expect(p.authorizationURL).toBe(
      "https://login.microsoftonline.com/my-tenant/oauth2/v2.1/authorize",
    );
    expect(p.tokenExchangeURL).toBe(
      "https://login.microsoftonline.com/my-tenant/oauth2/v2.1/token",
    );
    expect(p.userInfoURL).toBe("https://graph.microsoft.com/beta/me");
  });
});

describe("OAuth helper input handling", () => {
  const baseInput = {
    clientId: "id",
    clientSecret: "secret",
    callbackUrl: "https://app.test/cb",
  };

  it("merges extraScopes onto defaults and deduplicates", () => {
    const p = googleProvider({
      ...baseInput,
      extraScopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    expect(p.scope).toEqual([
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
  });

  it("applies endpoint overrides for self-hosted deployments", () => {
    const p = githubProvider({
      ...baseInput,
      endpoints: {
        authorizationURL: "https://ghe.internal/login/oauth/authorize",
        tokenExchangeURL: "https://ghe.internal/login/oauth/access_token",
        userInfoURL: "https://ghe.internal/api/v3/user",
      },
    });
    expect(p.authorizationURL).toBe("https://ghe.internal/login/oauth/authorize");
    expect(p.tokenExchangeURL).toBe("https://ghe.internal/login/oauth/access_token");
    expect(p.userInfoURL).toBe("https://ghe.internal/api/v3/user");
  });

  it("threads extraSessionFields through to the provider object", () => {
    const p = googleProvider({ ...baseInput, extraSessionFields });
    expect(p.extraSessionFields).toBe(extraSessionFields);
  });

  it("throws a configuration error when clientId is empty", () => {
    expect(() =>
      googleProvider({ clientId: undefined, clientSecret: "secret", callbackUrl: "https://app.test/cb" }),
    ).toThrow(/google clientId is empty/);
  });

  it("throws a configuration error when clientSecret is empty", () => {
    expect(() =>
      githubProvider({ clientId: "id", clientSecret: "", callbackUrl: "https://app.test/cb" }),
    ).toThrow(/github clientSecret is empty/);
  });
});

describe("OAuth provider registry", () => {
  beforeEach(() => {
    //? Reset to the documented default between tests so registry order in this
    //? file cannot leak into other suites sharing the module instance.
    registerOAuthProviders([{ name: "credentials" }]);
  });

  it("defaults to a credentials-only list", () => {
    expect(getOAuthProviders()).toEqual([{ name: "credentials" }]);
  });

  it("replaces the active list on register and returns it", () => {
    const google = googleProvider({
      clientId: "id",
      clientSecret: "secret",
      callbackUrl: "https://app.test/cb",
    });
    const returned = registerOAuthProviders([{ name: "credentials" }, google]);
    expect(returned).toEqual([{ name: "credentials" }, google]);
    expect(getOAuthProviders()).toBe(returned);
  });
});
