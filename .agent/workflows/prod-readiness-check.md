---
description: Run a comprehensive production readiness audit on the codebase
---

# Production Readiness Check Workflow

This workflow guides an AI assistant through auditing the LuckyStack application for production deployment.

## Pre-flight Checks

// turbo-all
Run these commands to verify build status:

1. Check TypeScript compilation:
```bash
npm run build
```

2. Validate Prisma schema:
```bash
npx prisma validate
```

3. Check migration status:
```bash
npx prisma migrate status
```

---

## Manual Audit Steps

### 1. API Security Audit

Scan all API files for proper authentication:

1. Find all API files:
```
Search for files matching: src/*/_api/*.ts
```

2. For each API file, verify:
   - [ ] Has `export const auth` 
   - [ ] Has `login: true` if it accesses user data
   - [ ] Has `admin: true` if it's in an admin folder or performs admin actions
   - [ ] Sensitive operations (delete, update, create) have proper auth

3. **Red flags to report:**
   - API in `admin/` folder without `{ key: 'admin', value: true }`
   - API modifying database without `login: true`
   - API returning all users without admin check

### 2. Sync Event Security

Scan all sync handler files:

1. Find sync server files:
```
Search for files matching: src/*/_sync/*_server.ts
```

2. For each sync file, verify:
   - [ ] Has appropriate auth for the action
   - [ ] Validates incoming `clientData`
   - [ ] Doesn't expose sensitive data to other clients

### 3. Environment Variables

Compare `.env` with `envTemplate.txt`:

1. Required for production:
   - [ ] `NODE_ENV=production`
   - [ ] `SECURE=true`
   - [ ] `DNS` set to production URL
   - [ ] `DATABASE_URL` is production database (not localhost)
   - [ ] `SENTRY_DSN` is configured

2. Secrets check:
   - [ ] No secrets committed to git (check .gitignore)
   - [ ] OAuth credentials are production values
   - [ ] Redis is secured or not publicly accessible

### 4. Error Handling Consistency

Search for error response patterns:

1. All errors should use format:
```typescript
{ status: 'error', message: 'Description' }
```

2. Search for old patterns to fix:
   - `error: true` - Should be `status: 'error'`
   - `success: false` - Should be `status: 'error'`

### 5. Configuration Review

Check `config.ts`:

1. Production settings:
   - [ ] `backendUrl` points to production
   - [ ] `dev` is `false`
   - [ ] `loginRedirectUrl` is appropriate
   - [ ] `singleSessionPerUser` is set based on security needs

### 6. Database Health

1. Schema validation passed (from pre-flight)
2. Check for:
   - [ ] No pending migrations
   - [ ] Indexes on frequently queried fields
   - [ ] Sensitive data is properly typed (passwords as optional)

---

## Report Template

After completing the audit, generate a report:

```markdown
# Production Readiness Report

**Date:** [Current Date]
**Status:** [READY / NOT READY / NEEDS REVIEW]

## Summary
[Brief overall assessment]

## Critical Issues
- [List any blocking issues]

## Warnings
- [List non-critical concerns]

## Passed Checks
- [List verified items]

## Recommendations
- [Suggestions for improvement]
```

---

## Quick Command Reference

```bash
# Build check
npm run build

# Database check
npx prisma validate
npx prisma migrate status

# Search for APIs without auth (example grep)
grep -r "export const main" src/*/_api/ --include="*.ts" -l | xargs grep -L "export const auth"

# Search for old error patterns
grep -r "error: true" src/ server/ --include="*.ts"
```