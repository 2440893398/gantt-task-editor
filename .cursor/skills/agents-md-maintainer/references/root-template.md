# Root AGENTS.md Template

Use this for root-level inclusion decisions and examples. For the canonical section templates, read `references/six-core-areas.md`.

## When to Include Each Section

| Section | Include if... | Omit if... |
|---------|---------------|------------|
| **Overview** | Always | — |
| **Build & Run** | Has any build system | Empty repo, pure data |
| **Testing** | Has tests | No test infrastructure |
| **Project Structure** | Multiple directories | Single-file project |
| **Code Style** | Has non-obvious conventions | Follows language defaults |
| **Git Workflow** | Has CI configs, commitlint, PR templates | No git conventions enforced |
| **Boundaries** | Has risky areas (DB, secrets, prod) | Simple library project |
| **Working Principles** | Existing agent behavior guidance or user requests it | Would be generic advice |
| **Documentation** | Has docs/ or wiki/ | No documentation |

## Examples

### Minimal (Library Project)
```markdown
# MyLib — Agent Instructions

## Overview
TypeScript utility library for string manipulation.

## Build & Run
npm install          # Install deps
npm run build        # Build to dist/
npm run test         # Run vitest
```

### Full Stack (Web App)
```markdown
# MyApp — Agent Instructions

## Overview
Next.js 14 web app with Prisma ORM and PostgreSQL.

## Build & Run
npm install          # Install deps
docker compose up    # Start Postgres
npm run dev          # Start dev server (port 3000)
npm run build        # Production build

## Testing
npm run test         # Run all tests
npm run test:e2e    # Run Playwright E2E tests

## Project Structure
src/
├── app/            # Next.js App Router pages
├── components/      # React components
├── lib/            # Utilities and Prisma client
└── server/         # API routes

## Boundaries
- ✅ **Always do:** Run `npm run lint && npm run test` before committing
- ⚠️ **Ask first:** Add new Prisma migration. Change API routes. Modify env vars.
- 🚫 **Never do:** Commit `.env` files. Push to `main` directly. Delete migrations.

## Working Principles
- Keep diffs focused on the requested change
- Match existing patterns before adding new abstractions
- Run the closest relevant verification before finishing
```
