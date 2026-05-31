# Six Core Areas Templates

Reference templates for the six core areas. Use only sections that apply.

---

## a) Build & Run — PUT FIRST

```markdown
## Build & Run

npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # Run ESLint
```

**Sources to read:**
- `package.json` → `scripts` section
- `Makefile` / `Justfile` → targets
- `pyproject.toml` → `[project.scripts]`
- `Cargo.toml` → standard cargo commands
- `.github/workflows/*.yml` → build/test steps

---

## b) Testing

```markdown
## Testing

pytest tests/ -v                    # Run all tests
pytest tests/test_auth.py -v        # Run single file
pytest -k "test_login" -v           # Run single test by name
pytest --cov=src --cov-report=term  # With coverage
```

**Include:**
- Test framework (pytest, vitest, JUnit, etc.)
- How to run all tests
- How to run single file
- How to run single test by name
- Coverage command (if configured)

**Omit if:** No test infrastructure exists.

---

## c) Project Structure

```markdown
## Project Structure

src/
├── api/          # FastAPI route handlers
├── models/       # Pydantic data models
├── services/     # Business logic
└── utils/        # Shared utilities

tests/            # Mirrors src/ structure
```

**Include:**
- Key directories and their purpose
- Entry points (`src/main.ts`, `src/index.py`)
- Where to add new features

---

## d) Code Style & Conventions

**One real code example beats three paragraphs.**

```markdown
## Code Style

- snake_case for functions and variables
- PascalCase for classes
- Type hints on all function signatures
- Async/await for I/O operations

### Example

```python
async def get_user_by_id(user_id: str) -> User:
    """Fetch a user by their unique identifier."""
    async with get_db_session() as session:
        return await session.get(User, user_id)
```
```

**Detect from:** Read 3-5 source files to identify patterns.

---

## e) Git Workflow

```markdown
## Git Workflow

- Branch naming: `feature/`, `fix/`, `chore/`
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`)
- Run `npm test && npm run lint` before committing
- PR titles follow conventional commit format
```

**Include only if evidence exists:** commitlint config, PR templates, CONTRIBUTING.md.

---

## f) Boundaries (Three-Tier System)

```markdown
## Boundaries

- ✅ **Always do:** Run tests before committing. Write tests for new features. Use type hints.
- ⚠️ **Ask first:** Adding new dependencies. Changing database schemas. Modifying CI/CD configs.
- 🚫 **Never do:** Commit secrets or credentials. Modify `vendor/` or `node_modules/`. Push directly to `main`.
```

**Tailor to project type:**
- Backend: schema changes, API contracts
- Frontend: breaking component APIs, design system changes
- Infrastructure: production configs, IAM permissions

---

## Optional: Working Principles

Use this section sparingly for provider-neutral behavior rules that reduce common coding-agent mistakes. Prefer concrete actions over personality or thinking instructions.

```markdown
## Working Principles

- Ask before editing when requirements are ambiguous or multiple interpretations are plausible.
- Keep diffs focused on the requested change; mention unrelated issues instead of fixing them.
- Match existing style and patterns before introducing new abstractions.
- Run the smallest relevant verification before finishing, and report anything not run.
```

**Include if:**
- The repo already has useful agent behavior guidance in `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, or Copilot instructions.
- The user explicitly asks for general agent guardrails.
- The project has a history of over-broad diffs, speculative abstractions, or missed verification.

**Omit if:** The bullets would be generic advice that could apply unchanged to any repository.

---

## Usage Notes

- Use only sections that apply to the project.
- Put core sections in this order: Build & Run → Testing → Project Structure → Code Style → Git Workflow → Boundaries.
- If included, place Working Principles after Boundaries.
- For complete root-level examples with decision guidance, see `references/root-template.md`.
- For nested AGENTS.md files, see `references/nested-template.md`.
