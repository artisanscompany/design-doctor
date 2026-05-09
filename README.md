# design-doctor

Your agent writes ugly UI. design-doctor catches it.

A static-analysis CLI for React UX/UI that scores your codebase 0–100 and installs as an agent skill for Claude Code, Codex, Cursor, and Copilot. Tuned for Rails+Inertia and TanStack stacks.

## Quick start

```bash
npx -y design-doctor@latest scan .
```

That's it. Zero config, zero install. Works on any machine with Node 18+.

For a project under active development:

```bash
npx -y design-doctor@latest scan . --verbose --diff   # only files changed vs main
npx -y design-doctor@latest scan . --score            # CI gate
npx -y design-doctor@latest scan . --markdown         # PR-ready
```

## What it catches

Things that don't show up in ESLint, type-checking, or tests:

| Category   | Examples                                                                         |
|------------|----------------------------------------------------------------------------------|
| `design/`  | 14 shades of blue, `p-[13px]` arbitrary values, 6 z-index values, shadow sprawl, dark-mode pairing |
| `copy/`    | "Click here", `...` instead of `…`, `&quot;` HTML entities, sentence-shaped CTAs |
| `a11y/`    | Icon buttons with no label, `<div onClick>`, `outline:none`, heading skips       |
| `forms/`   | Placeholder-as-label, missing `inputMode`, error messages without `aria-describedby` |
| `ui/`      | Reads `isLoading` but never renders it; lists with no empty state                |
| `inertia/` | `<a href="/internal">` instead of `<Link>`, `<form onSubmit>` instead of `useForm` |
| `tanstack/`| Routes without `errorComponent` / `pendingComponent` / `validateSearch`          |
| `stack/`   | Devtools rendered without env guards                                             |

## Installation as an agent skill

```bash
npx -y design-doctor@latest install
```

Drops `SKILL.md` into every detected agent directory:
- `~/.claude/skills/design-doctor/`
- `~/.agents/skills/design-doctor/` (Codex)
- `~/.cursor/skills/design-doctor/`
- `~/.codeium/windsurf/skills/design-doctor/`
- `~/.config/github-copilot/skills/design-doctor/`
- `~/.config/opencode/skills/design-doctor/`

After install, your agent will run design-doctor automatically when finishing a feature or fixing a UI bug.

## Scoring

| Score | Grade        |
|-------|--------------|
| 75+   | Great        |
| 50–74 | Needs work   |
| < 50  | Critical     |

Per-unique-rule penalty: each unique error rule deducts 1.5 points, each unique warning rule deducts 0.75. One rule firing 100 times still only deducts once — score reflects diversity of breakage, not count.

## Configuration

Drop `.designdoctor.json` at the project root:

```json
{
  "preset": "default",
  "disable": ["copy/i18n-leak", "design/dark-mode-pairing"],
  "severity": {
    "a11y/icon-only-button-no-label": "error"
  },
  "thresholds": {
    "colorClusterMinSize": 3,
    "fontWeightMaxCardinality": 4,
    "fontFamilyMaxCardinality": 2,
    "zIndexMaxCardinality": 6,
    "shadowMaxCardinality": 5
  }
}
```

## CI integration

Add to your workflow:

```yaml
- run: npx -y design-doctor@latest scan . --score --min-score 75
```

Or comment on PRs:

```yaml
- run: npx -y design-doctor@latest scan . --markdown > /tmp/report.md
- uses: peter-evans/create-or-update-comment@v4
  with:
    issue-number: ${{ github.event.pull_request.number }}
    body-path: /tmp/report.md
```

## Companion tools

- **Rails backend**: [`rails-doctor`](https://github.com/artisanscompany/rails-doctor) — same npm + agent-skill model, scans the Ruby side.
- **General React lint**: [`react-doctor`](https://github.com/millionco/react-doctor) — broader code-quality, dead-code, bundle-size.

In a Rails+Inertia monorepo, run all three. design-doctor scans only the frontend dir (`app/frontend/`, `app/javascript/`, etc.).

## Why static analysis for UX/UI?

Most UX problems aren't about visual judgment — they're about consistency and convention. A team uses 14 shades of blue because nobody noticed; a button says "Click here" because the agent didn't know better; a form uses placeholder-as-label because the example it copied did. Those are all detectable from source.

A vision pass (LLM grading screenshots with a rubric) is on the v0.2 roadmap. It will fold into the score for things static analysis can't see — visual hierarchy, density, polish.

## License

MIT. See `LICENSE`.
