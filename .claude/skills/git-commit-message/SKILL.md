---
name: git-commit
description: >
  Use this skill whenever the user wants to commit code, write a git commit message,
  stage changes, or run git commit. Trigger even for casual requests like "commit this",
  "save my changes", or "push this". Always use this skill for any git commit task.
---

# Git Commit

## Rules
- Every file gets its own commit with its own message
- Messages describe what changed in that specific file, nothing else
- No conventional commit prefixes (no feat:, fix:, chore:, refactor:, docs:, etc.)
- No "Co-authored-by" or any Claude attribution lines
- No emoji
- Keep messages short and plain — what changed, in plain English

## Message Format
```
<short summary of what changed in this file>
```

One line only. No body. No footer. No bullet points.

## Workflow

1. Run `git status` to see all changed files
2. Run `git diff <file>` for each changed file to understand what actually changed
3. Stage and commit each file separately:
   ```
   git add <file>
   git commit -m "<message specific to this file>"
   ```
4. Repeat for every changed file
5. Never batch multiple files into one commit unless the user explicitly asks

## Message Examples

| Change | Good message | Bad message |
|--------|-------------|-------------|
| Added input validation to login form | `add input validation to login form` | `feat: add validation` |
| Fixed null check in user service | `fix null check in user service` | `fix: null pointer bug` |
| Updated README with setup steps | `update README with setup steps` | `docs: update readme` |
| Removed unused imports in utils.js | `remove unused imports in utils` | `chore: cleanup` |

## What NOT to Do
- Don't use `git add .` and commit everything at once
- Don't write generic messages like "update files" or "fix bug"
- Don't add `Co-authored-by: Claude` or any similar line
- Don't use conventional commit types as prefixes
