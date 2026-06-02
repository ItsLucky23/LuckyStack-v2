import { describe, it, expect, vi, beforeEach } from "vitest";

import type { UserAdapter, UserRecord } from "./userAdapter";

//? userAdapter.ts imports the `prisma` proxy from @luckystack/core. We mock it
//? with a fake `user` delegate so the default adapter's CRUD methods route to
//? spies instead of a live database. The registry itself (register / get /
//? isRegistered) is pure module state. `vi.hoisted` lets the spies exist both
//? inside the hoisted mock factory and in the test body.
const prismaUser = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@luckystack/core", () => ({
  prisma: { user: prismaUser },
}));

import {
  registerUserAdapter,
  isUserAdapterRegistered,
  getUserAdapter,
  defaultPrismaUserAdapter,
} from "./userAdapter";

const sampleRecord: UserRecord = { id: "u1", token: "tok-u1", email: "a@b.test", provider: "credentials" };

describe("userAdapter registry", () => {
  beforeEach(() => {
    //? The module caches the default adapter and remembers a registered one.
    //? vi.resetModules between files is not in play here, so we cannot un-register.
    //? Each test that needs the default re-derives it via defaultPrismaUserAdapter().
    prismaUser.findFirst.mockReset();
    prismaUser.findUnique.mockReset();
    prismaUser.create.mockReset();
    prismaUser.update.mockReset();
  });

  it("reports no custom adapter before registration", () => {
    expect(isUserAdapterRegistered()).toBe(false);
  });

  it("getUserAdapter falls back to the default Prisma adapter when none registered", async () => {
    prismaUser.findFirst.mockResolvedValue(sampleRecord);
    const adapter = getUserAdapter();
    const found = await adapter.findByEmail({ email: "a@b.test", provider: "credentials" });
    expect(found).toEqual(sampleRecord);
    expect(prismaUser.findFirst).toHaveBeenCalledWith({
      where: { email: "a@b.test", provider: "credentials" },
    });
  });

  it("registerUserAdapter overrides the default and is returned by getUserAdapter", () => {
    const custom: UserAdapter = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    const returned = registerUserAdapter(custom);
    expect(returned).toBe(custom);
    expect(isUserAdapterRegistered()).toBe(true);
    expect(getUserAdapter()).toBe(custom);
  });
});

describe("defaultPrismaUserAdapter delegation", () => {
  beforeEach(() => {
    prismaUser.findFirst.mockReset();
    prismaUser.findUnique.mockReset();
    prismaUser.create.mockReset();
    prismaUser.update.mockReset();
  });

  it("findById delegates to prisma.user.findUnique", async () => {
    prismaUser.findUnique.mockResolvedValue(sampleRecord);
    const adapter = defaultPrismaUserAdapter();
    const result = await adapter.findById("u1");
    expect(result).toEqual(sampleRecord);
    expect(prismaUser.findUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("create maps the adapter input onto the documented Prisma columns", async () => {
    prismaUser.create.mockResolvedValue(sampleRecord);
    const adapter = defaultPrismaUserAdapter();
    await adapter.create({
      email: "a@b.test",
      provider: "credentials",
      name: "Ada",
      password: "hashed",
      avatar: "pic.webp",
      avatarFallback: "#abcdef",
      language: "en",
    });
    expect(prismaUser.create).toHaveBeenCalledWith({
      data: {
        email: "a@b.test",
        provider: "credentials",
        name: "Ada",
        password: "hashed",
        avatar: "pic.webp",
        avatarFallback: "#abcdef",
        language: "en",
      },
    });
  });

  it("create defaults password to null and avatar to empty string when omitted", async () => {
    prismaUser.create.mockResolvedValue(sampleRecord);
    const adapter = defaultPrismaUserAdapter();
    await adapter.create({ email: "a@b.test", provider: "google" });
    expect(prismaUser.create).toHaveBeenCalledWith({
      data: {
        email: "a@b.test",
        provider: "google",
        name: undefined,
        password: null,
        avatar: "",
        avatarFallback: undefined,
        language: undefined,
      },
    });
  });

  it("update delegates the patch to prisma.user.update", async () => {
    prismaUser.update.mockResolvedValue(sampleRecord);
    const adapter = defaultPrismaUserAdapter();
    await adapter.update("u1", { email: "new@b.test" });
    expect(prismaUser.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { email: "new@b.test" },
    });
  });
});
