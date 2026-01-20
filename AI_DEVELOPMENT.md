# AI-Assisted Development Guide

This guide covers how to work with AI coding assistants (like Cursor, Copilot, Claude) in the LuckyStack codebase, including the production readiness checklist.

---

## Table of Contents

1. [Understanding .cursorrules](#understanding-cursorrules)
2. [Required File Updates](#required-file-updates)
3. [Production Readiness Checklist](#production-readiness-checklist)
4. [Contributing to the Framework](#contributing-to-the-framework)
5. [Security Best Practices](#security-best-practices)

---

## Understanding .cursorrules

The `.cursorrules` file at the project root tells AI assistants how to work with this codebase. It points to key context files:

| File | Purpose |
|------|---------|
| `PROJECT_CONTEXT.md` | Architecture overview, terminology, design decisions |
| `repomix-output.xml` | Compressed codebase dump for quick scanning |
| `config.ts` | Application configuration and type definitions |
| `.env` | Active environment variables |

### How AI Should Use These Files

```
1. START → Read PROJECT_CONTEXT.md for architecture understanding
2. SEARCH → Check repomix-output.xml for code patterns
3. VERIFY → Check config.ts and .env for configuration values
4. IMPLEMENT → Make changes with context in mind
5. UPDATE → Update PROJECT_CONTEXT.md and regenerate repomix
```

---

## Required File Updates

### After Every Code Change

When you (or an AI) makes code changes, these files **MUST** be updated:

#### 1. Update `PROJECT_CONTEXT.md`

Document any:
- New files or folders created
- New functions or components
- Changed behavior or patterns
- New configuration options
- New APIs or sync events

#### 2. Regenerate `repomix-output.xml`

Run this command after making changes:

```bash
npx repomix
```

This creates a fresh dump of the codebase for future AI sessions.

### Why This Matters

AI assistants don't remember between sessions. These files ensure:
- The next AI session has accurate context
- You don't have to re-explain the project
- Consistent code patterns are maintained

---

## Production Readiness Checklist

Use this checklist before deploying to production. AI assistants can audit these items.

### 1. API Security Audit

Check all files in `src/*/_api/*.ts`:

| Check | Description |
|-------|-------------|
| ✅ Has `auth` export | Every API should export an `auth` object |
| ✅ Login required | Sensitive APIs have `login: true` |
| ✅ Admin protected | Admin-only APIs have `additional: [{ key: 'admin', value: true }]` |
| ✅ Correct folder | APIs in `admin/` folders require admin auth |

**Example of correct auth:**

```typescript
// src/admin/_api/deleteUser.ts
export const auth = {
  login: true,
  additional: [{ key: 'admin', value: true }]  // Required for admin folder!
};
```

**🚨 Red flags to look for:**
- API in `admin/` folder without `admin: true`
- Sensitive operations (delete, update) without login requirement
- API returning user data without authentication

### 2. Environment Variables

| Check | Command |
|-------|---------|
| All required vars set | Compare `.env` with `envTemplate.txt` |
| No hardcoded secrets | Search for hardcoded API keys, passwords |
| Production DATABASE_URL | Verify it's not pointing to localhost |
| SECURE=true | HTTPS should be enabled in production |

### 3. Error Handling

| Check | Description |
|-------|-------------|
| Sentry configured | `SENTRY_DSN` is set in production |
| No exposed internals | Error messages don't leak stack traces |
| Consistent format | All errors use `{ status: 'error', message: '...' }` |

### 4. Database

```bash
# Validate schema
npx prisma validate

# No errors should appear
```

### 5. Build Verification

```bash
# TypeScript should compile without errors
npm run build

# No errors should appear
```

### 6. Authentication Flows

| Check | Description |
|-------|-------------|
| OAuth callbacks | All providers have correct callback URLs |
| Session expiry | `sessionExpiryDays` is appropriate |
| Single session | `singleSessionPerUser` is set based on requirements |

---

## Contributing to the Framework

### Found a Reusable Feature?

If you've built something that could benefit the LuckyStack framework itself (not just your app), consider contributing:

#### 1. Open a GitHub Issue

Go to the [LuckyStack repository](https://github.com/ItsLucky23/LuckyStack-v2) and open an issue:

- **Title**: `[Feature Request] Brief description`
- **Description**: What the feature does and why it's useful
- **Example code**: How you implemented it
- **Breaking changes**: Whether it affects existing apps

#### 2. Feature Request Template

```markdown
## Feature Description
What does this feature do?

## Use Case
Why would someone need this?

## Proposed Implementation
How should it work?

## Code Example
\`\`\`typescript
// Your implementation
\`\`\`

## Breaking Changes
Does this affect existing LuckyStack apps?
```

### Framework vs. Application Code

| Framework Code | Application Code |
|----------------|------------------|
| Shared utilities | Page-specific logic |
| Socket handlers | Custom APIs |
| Authentication | Business logic |
| Session management | UI components |

If your feature fits in "Framework Code", it might be worth contributing!

---

## Security Best Practices

### CSRF Protection

LuckyStack's WebSocket-first architecture is **naturally resistant to CSRF** because:

1. WebSocket connections require explicit JavaScript code to establish
2. The `checkOrigin.ts` validates the `Origin` header on every connection
3. Cookies are `HttpOnly` and `SameSite=Strict`

However, always ensure:
- `EXTERNAL_ORIGINS` in `.env` only contains trusted domains
- OAuth callback URLs are specific (not wildcards)

### Session Security

| Setting | Recommended |
|---------|-------------|
| `singleSessionPerUser` | `true` for sensitive apps |
| `sessionExpiryDays` | 7 or less for high-security |
| `SECURE` | `true` in production |
| `VITE_SESSION_BASED_TOKEN` | `false` uses cookies instead of session |

### Input Validation

Always validate incoming data:

```typescript
// With Zod (recommended)
import { z } from 'zod';

export const schema = z.object({
  email: z.string().email(),
  age: z.number().min(0).max(150)
});

// Without Zod - manual validation
export const main = async ({ data }) => {
  if (!data.email || typeof data.email !== 'string') {
    return { status: 'error', message: 'Invalid email' };
  }
  // ...
};
```

---

## Quick Reference

### AI Prompt Templates

**For code review:**
> "Review the APIs in `src/admin/_api/` and verify all have admin authentication."

**For security audit:**
> "Scan for any APIs returning sensitive data without login: true authentication."

**For production check:**
> "Run through the production readiness checklist in AI_DEVELOPMENT.md"

**For documentation update:**
> "Update PROJECT_CONTEXT.md to include the new [feature] I added in [file]."
