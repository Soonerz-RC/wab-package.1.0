# Starter Prompt — WAB Package 1.0

**Version:** 2026-05-21 (supersedes 2026-05-19 starter prompt)
**Purpose:** This is the exact message to paste into Claude Code at the start of your first session in this project. All paths and the GitHub remote URL are already filled in — no edits needed.

---

## Before you paste

1. The four foundation documents are already in your project folder at `/Users/gibber/Downloads/Claude_Dev/wab-package.1.0/`:
   - `2026-05-21-CLAUDE.md` (the working CLAUDE.md — supersedes earlier drafts)
   - `2026-05-19-data-model-spec.md`
   - `2026-05-21-build-roadmap.md`
   - `2026-05-21-starter-prompt.md` (this file)
   - Earlier-dated drafts (`2026-05-19-CLAUDE.md`, `2026-05-19-CLAUDE-amended.md`, `2026-05-19-build-roadmap.md`, `2026-05-19-starter-prompt.md`) may also be present. Claude Code will identify these and propose cleanup as part of Phase 1.

2. Open Claude Code in your terminal:
   ```
   cd /Users/gibber/Downloads/Claude_Dev/wab-package.1.0/
   claude
   ```

3. The GitHub repo is already created at `https://github.com/Soonerz-RC/wab-package.1.0.git` and is empty, ready to receive the initial commit.

4. Paste the prompt below as your first message. No edits needed.

---

## The prompt

```
We're starting a new project: a static, link-gated data room on Netlify
for buyers evaluating WAB Package 1.0 — a mineral and ORRI package in
the Western Anadarko Basin owned by GBK International Group (Oklahoma
Minerals). I've already prepared the project's foundation documents and
want you to work strictly within them.

The project folder is the directory you're already in:
  /Users/gibber/Downloads/Claude_Dev/wab-package.1.0/

Four foundation documents are already in this folder:

  1. 2026-05-21-CLAUDE.md — the project constitution. Read this first.
     It defines the repo structure, tech stack, hard rules, working
     preferences, and glossary. THIS is the working CLAUDE.md and
     supersedes any earlier-dated CLAUDE drafts (2026-05-19-CLAUDE.md
     or 2026-05-19-CLAUDE-amended.md) that may also be in the folder.
     Once placed in the repo root and renamed to exactly CLAUDE.md, you
     will read it automatically every session.

  2. 2026-05-19-data-model-spec.md — the authoritative schema for every
     JSON file the project produces. (Dated 2026-05-19 because the spec
     itself didn't change in the 2026-05-21 update.)

  3. 2026-05-21-build-roadmap.md — the phased plan we're going to
     execute, one phase at a time.

  4. 2026-05-21-starter-prompt.md — this very prompt, for reference.

GitHub remote for this project (already created, empty):
  https://github.com/Soonerz-RC/wab-package.1.0.git

Please:

  1. Read all four foundation documents fully before doing anything else.
     If you find earlier-dated CLAUDE drafts, do not read them as
     authoritative — only the 2026-05-21 version is.
  2. Confirm back to me, in your own words, your understanding of:
       - The project purpose
       - The hard rules in CLAUDE.md §3
       - The working preferences in CLAUDE.md §4
       - How tract IDs are assigned and frozen (spec §3)
       - How permits/completions/production join through wells (spec §5)
  3. Identify any superseded files in the folder (earlier-dated CLAUDE
     drafts and earlier roadmap/starter-prompt drafts) and propose what
     to do with them. Wait for my approval before deleting or moving
     anything.
  4. Then propose your plan for Phase 1 (organize foundation docs +
     scaffold the repo) per the build roadmap.
  5. Wait for my approval before writing any code or creating any files.

A few reminders that override anything else if there's ambiguity:

  - Plan-then-approve for every multi-step task.
  - One phase at a time. Do not chain ahead.
  - data-raw/ is read-only except for the inventory archive and the
    id-registry, as carved out in the spec.
  - data/ is generated; never hand-edit.
  - Never invent numbers. If source data is missing, the field is null.
  - Confirm before any destructive file operation.
  - End every task with the file list (created and modified, absolute
    paths).

I am not a programmer but I am technically literate. Explain decisions
in plain English. Ask any questions you need.

Ready when you are.
```

---

## What to expect from Claude Code's first response

A well-behaved response will:

1. Acknowledge it has read the four documents and identified the working CLAUDE.md correctly (the 2026-05-21 version).
2. Echo back, in its own words, the key concepts you asked it to confirm. This is your check that it actually understood — not just that it claimed to.
3. List the superseded files it found and propose cleanup.
4. Propose a concrete plan for Phase 1: the order of operations, what files will be created, what it needs from you.
5. **Stop and wait** for your approval before executing.

If it skips any of those steps, or starts creating files without approval, push back. CLAUDE.md is clear on this and Claude Code should honor it.

---

## After Phase 1

Open `docs/2026-05-21-build-roadmap.md` in the repo, find Phase 2, and use that phase's "Recommended kickoff prompt" as your next message. Repeat for Phases 3–7.

The roadmap is designed so each phase's prompt is copy-paste ready.

---

## If you need to restart a session mid-project

When you open a new Claude Code session later, CLAUDE.md will be in the repo root and gets auto-loaded — you don't need to re-paste the foundation. Just open Claude Code in the project folder and say something like:

```
We're at Phase 4 of docs/2026-05-21-build-roadmap.md. Pick up there
and propose your plan.
```

That's enough. CLAUDE.md does the heavy lifting.

---

## When WAB Package 2.0 comes along

The architecture is designed for reuse. When the next package is ready:

1. Create a new GitHub repo `wab-package.2.0` and a new local folder.
2. Copy the foundation documents from this repo, update version numbers and any package-specific details (county scope, owner counts, etc.).
3. Run through the roadmap again — most phases will be largely mechanical the second time through.

If Phase 9 (the refresh skill) has been packaged by then, it should handle most of the recurring work automatically.

---

## End of Starter Prompt
