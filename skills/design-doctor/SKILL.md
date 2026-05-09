---
name: design-doctor
description: Use when finishing a frontend feature, fixing a UI bug, before committing React/Inertia/TanStack code, or when the user wants a UX/UI health check. Static-analysis CLI scoring 0–100. Covers design-token sprawl (color/spacing/typography/z-index/shadow), microcopy quality (CTA shape, banned phrases, smart quotes, inclusive language), accessibility patterns beyond eslint-plugin-jsx-a11y (icon buttons, tap targets, focus replacement, heading order, onclick-on-div), form UX (label vs placeholder, inputmode, error association, submit loading), missing loading/error/empty states, Inertia conventions (Link vs <a>, useForm), TanStack route hygiene (errorComponent, pendingComponent, validateSearch), and devtools-in-prod.
version: "1.2.0"
---

# Design Doctor

Scans React frontends — particularly Rails+Inertia and TanStack apps — for UX/UI issues that don't show up in ESLint, type-checking, or tests. Outputs a 0–100 health score using the same per-unique-rule formula as react-doctor and rails-doctor.

## After making frontend changes

Run `npx -y design-doctor@latest scan . --verbose --diff` and check the score did not regress. Fix any new issues before committing.

## For general UI cleanup

Run `npx -y design-doctor@latest scan . --verbose` (without `--diff`) for a full sweep. Fix by severity — errors first, then warnings, then info.

## Command

```bash
npx -y design-doctor@latest scan . --verbose --diff
```

| Flag | Purpose |
|---|---|
| `.` | Scan current directory |
| `--verbose` | Show all rules, full file lists |
| `--diff [BASE]` | Only scan files changed vs base (default `main`) |
| `--score` | Output only the numeric score (CI gate) |
| `--strict` | Promote warnings to errors |
| `--full` | Show all categories without truncation |
| `--json` | Machine-readable output |
| `--markdown` | PR-comment-ready output |
| `--fail-on error\|warning\|none` | Exit non-zero policy |
| `--min-score N` | Exit non-zero if score < N |

## Distribution

**Distributed via npm — NOT a Ruby gem, not a Python package.** Do not try `gem install`, `bundle exec`, `pip install`, or anything else. Use:

```bash
npx -y design-doctor@latest scan .
```

Works on any machine with Node 18+. Zero runtime dependencies in the core scan path.

## Vision pass (optional, agent-graded)

When the user wants a deeper review than static analysis can give — visual hierarchy, polish, brand coherence, mobile adaptation — run the vision pass. The agent does the grading itself; design-doctor handles screenshotting and folding the scores back in.

**Three steps:**

1. **Capture screenshots and emit the rubric.** A dev server must be running.
   ```bash
   npx -y design-doctor@latest scan . --vision --url http://localhost:3000
   ```
   This drops screenshots under `.design-doctor/screenshots/` and a rubric at `.design-doctor/rubric.md`, plus a starter `.design-doctor/vision.template.json`.

2. **Grade the screenshots yourself.** Read `.design-doctor/rubric.md` and look at each screenshot in `.design-doctor/screenshots/`. For every route, score each of 10 sub-dimensions 0–10 with a one-line evidence quote. Save your judgments to `.design-doctor/vision.json` (copy the template and fill it in — set every score to a real value, replace empty evidence strings).

3. **Fold the vision scores into the final score.**
   ```bash
   npx -y design-doctor@latest finalize
   ```
   This produces `.design-doctor/final.json` and prints the composite score.

**Scoring with vision:** static is capped at 70 once vision runs. Vision contributes up to 30. The full 100 requires both passing the linter and looking great in screenshots — you can't hit a 100 from static alone when running with `--vision`.

**Auth:** if your app needs login, set `DESIGNDOCTOR_LOGIN_URL`, `DESIGNDOCTOR_USER`, `DESIGNDOCTOR_PASS` (works with most email + password forms). For complex flows, point `DESIGNDOCTOR_LOGIN_SCRIPT` at a JS file exporting `async login(page, baseUrl)`.

**Playwright:** the vision pass needs Playwright installed. design-doctor declares it as an optional peer dep; install once with `npm i -D playwright && npx playwright install chromium`.

## What it covers (built-in static rules)

- **design/** — color clusters (perceptual ΔE), arbitrary Tailwind values, font-weight cardinality, font-family cardinality, z-index ladder, shadow sprawl, mixed units, dark-mode pairing, missing token source.
- **copy/** — CTA shape (length, sentence-form, trailing period), banned phrases (\"Click here\", \"Submit\", \"Learn more\"), ASCII ellipsis/quotes, toast/alert punctuation, inclusive language, HTML entities, i18n leak (TanStack only).
- **a11y/** — icon-only buttons without labels, conservative tap-target heuristics, outline-removed-without-replacement, click-handler-on-div, placeholder-as-label, missing `lang`, autocomplete hints, single-file heading hierarchy.
- **forms/** — label-above-not-placeholder, missing inputMode/type, required-without-aria-required, error-not-associated-by-aria-describedby, submit-without-loading-state.
- **ui/** — components that read `isLoading`/`error` but never render those branches; lists rendered without empty-state guards.
- **inertia/** — internal nav using `<a href>` instead of `<Link>` (info), `<form onSubmit>` instead of `useForm` (info), Inertia::render strings without a matching page component.
- **tanstack/** — routes with loaders missing `errorComponent` / `pendingComponent`; routes reading search params without `validateSearch`.
- **stack/** — devtools rendered without env guards.

## What it does NOT cover (use a companion tool)

- **Rails / backend code quality** — use rails-doctor in the same repo.
- **General React code-quality / lint / dead-code / bundle size** — use react-doctor.
- **Pure type-checking** — keep using `tsc`.
- **Runtime accessibility** — pair with `axe-core`/`@axe-core/react` in dev.

When scanning a Rails+Inertia monorepo, design-doctor scans the frontend dir (`app/frontend/`, `app/javascript/`, etc.) only. Run rails-doctor separately for the Ruby side.

## Configuration

Drop a `.designdoctor.json` (or `designdoctor.config.json`) at the project root:

```json
{
  "preset": "default",
  "allow": ["dark-mode", "single-locale"],
  "disable": ["copy/i18n-leak", "design/dark-mode-pairing"],
  "severity": {
    "a11y/icon-only-button-no-label": "error",
    "design/color-cluster": "warning"
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

## Scoring

| Score | Grade |
|---|---|
| 75+ | Great |
| 50–74 | Needs work |
| < 50 | Critical |

Per-unique-rule penalty: each unique error rule deducts 1.5 points, each unique warning rule deducts 0.75. One rule firing 100 times still only deducts once — score reflects diversity of breakage, not count.

When the optional vision pass lands (v0.2), static will be capped at 70 and the vision pass earns the remaining 30; today (v0.1, static-only) the scale is the full 0–100.

## Coding guidance for agents (apply when writing new UI code)

When generating React/Inertia/TanStack UI, default to these patterns unless `.designdoctor.json` or existing code says otherwise:

1. **Tokens, not literals.** Pick from Tailwind's scale or the project's CSS variables. Reach for `[#abc]` / `[13px]` / inline `#hex` only as a last resort.
2. **Buttons say a verb.** \"Save changes\" not \"Click here to save\". 1–4 words. No trailing period.
3. **Labels live above the field.** Placeholder is a hint, not a label. Use `<label htmlFor>` or `aria-label`.
4. **Icon-only buttons need `aria-label`.** Or a visually-hidden `<span className=\"sr-only\">` child.
5. **Don't remove the focus outline.** If you do, replace it with `focus-visible:ring-2` or equivalent.
6. **Use the right element.** `<button>` for actions, `<a>` for navigation. `<div onClick>` is almost never right.
7. **Render every state your hook returns.** If the hook says `{data, isLoading, error}`, render branches for all three, plus an empty state if data is a list.
8. **Inertia: use `<Link>` and `useForm`.** Internal nav with `<a href>` causes a full reload. `useForm` carries CSRF + server errors + processing state.
9. **TanStack routes: pendingComponent + errorComponent + validateSearch.** Loaders without `pendingComponent` flash blank. Without `errorComponent` they crash. Reading search without `validateSearch` lets a malformed URL break the page.
10. **Devtools behind `import.meta.env.DEV`.** Never ship `<ReactQueryDevtools/>` or `<TanStackRouterDevtools/>` to production users.
11. **Curly quotes in prose; … not …; sentence-case toasts end with periods.**

## Reference

- `npx -y design-doctor@latest explain <rule-id>` — full rule documentation
- `npx -y design-doctor@latest rules` — full rule catalog
- Source: https://github.com/artisanscompany/design-doctor
