import { defineRule } from "./registry.js";

// =============================================================================
// design/
// =============================================================================
defineRule({
  id: "design/no-token-source",
  title: "No design-token source detected",
  category: "design",
  defaultSeverity: "warning",
  fix: "Add a tailwind.config.{js,ts}, CSS custom-property file, or design-tokens.json so colors/spacing/type live in one place.",
});
defineRule({
  id: "design/color-cluster",
  title: "Near-duplicate colors across the codebase",
  category: "design",
  defaultSeverity: "warning",
  fix: "Consolidate near-duplicate colors into a single token. Same hue ≠ same intent — pick one.",
});
defineRule({
  id: "design/arbitrary-tailwind-value",
  title: "Arbitrary Tailwind value bypasses the scale",
  category: "design",
  defaultSeverity: "warning",
  fix: "Use a scale token (`p-3`, `text-sm`) instead of `[13px]`/`[#abc]`. Extend the config if the token is genuinely missing.",
});
defineRule({
  id: "design/font-weight-cardinality",
  title: "Too many distinct font weights",
  category: "design",
  defaultSeverity: "warning",
  fix: "Most UIs need 3 weights (regular/medium/bold). Pick a small set and stick to it.",
});
defineRule({
  id: "design/font-family-cardinality",
  title: "Too many font families",
  category: "design",
  defaultSeverity: "warning",
  fix: "One sans + optionally one mono is plenty. Extra families make the UI feel chaotic.",
});
defineRule({
  id: "design/zindex-ladder",
  title: "Z-index sprawl",
  category: "design",
  defaultSeverity: "warning",
  fix: "Define a named z-scale (dropdown/sticky/modal/toast/tooltip) and reference it.",
});
defineRule({
  id: "design/shadow-sprawl",
  title: "Too many distinct shadows",
  category: "design",
  defaultSeverity: "info",
  fix: "Most design systems have 3–5 elevation tokens. Consolidate.",
});
defineRule({
  id: "design/mixed-units",
  title: "Mixed length units in the same file",
  category: "design",
  defaultSeverity: "info",
  fix: "Pick one of px or rem for spacing/sizing and stay consistent.",
});
defineRule({
  id: "design/dark-mode-pairing",
  title: "Tailwind class without paired dark: variant",
  category: "design",
  defaultSeverity: "info",
  fix: "If the project supports dark mode, every theming class (bg-, text-, border-) needs a paired `dark:` sibling.",
});

// =============================================================================
// copy/
// =============================================================================
defineRule({
  id: "copy/cta-too-long",
  title: "CTA button text is too long or sentence-shaped",
  category: "copy",
  defaultSeverity: "warning",
  fix: "CTAs should be 1–4 words, verb-first, no period. \"Save changes\" not \"Click here to save your changes.\"",
});
defineRule({
  id: "copy/banned-phrase",
  title: "Banned UX phrase",
  category: "copy",
  defaultSeverity: "warning",
  fix: "Replace generic CTAs (\"Click here\", \"Submit\", \"Learn more\") with descriptive labels (\"Read the pricing guide\").",
});
defineRule({
  id: "copy/ascii-ellipsis",
  title: "ASCII ellipsis in user-facing string",
  category: "copy",
  defaultSeverity: "info",
  fix: "Use the Unicode ellipsis (…) instead of three dots (...).",
});
defineRule({
  id: "copy/ascii-quotes",
  title: "ASCII quotes in prose",
  category: "copy",
  defaultSeverity: "info",
  fix: "Use curly quotes (“ ” ‘ ’) for prose; straight quotes belong in code.",
});
defineRule({
  id: "copy/toast-punctuation",
  title: "Toast or alert sentence missing terminal punctuation",
  category: "copy",
  defaultSeverity: "info",
  fix: "Full sentences in toasts/alerts/notifications should end with a period.",
});
defineRule({
  id: "copy/button-trailing-period",
  title: "Button label ends in a period",
  category: "copy",
  defaultSeverity: "info",
  fix: "Button labels are not sentences. Drop the trailing period.",
});
defineRule({
  id: "copy/i18n-leak",
  title: "User-facing string not wrapped for i18n",
  category: "copy",
  defaultSeverity: "warning",
  fix: "Project has an i18n library — wrap visible strings (`t('key')` / `<Trans>`) so they can be translated.",
});
defineRule({
  id: "copy/inclusive-language",
  title: "Non-inclusive language in user-facing string",
  category: "copy",
  defaultSeverity: "warning",
  fix: "Pick neutral language (allowlist/blocklist over whitelist/blacklist; primary/replica over master/slave).",
});
defineRule({
  id: "copy/html-entity",
  title: "HTML entity in JSX where Unicode would do",
  category: "copy",
  defaultSeverity: "info",
  fix: "JSX renders text directly — write & not &amp; in JSX text.",
});

// =============================================================================
// a11y/
// =============================================================================
defineRule({
  id: "a11y/icon-only-button-no-label",
  title: "Icon-only button has no accessible name",
  category: "a11y",
  defaultSeverity: "error",
  fix: "Add an `aria-label`, a visually-hidden `<span className=\"sr-only\">`, or visible text.",
});
defineRule({
  id: "a11y/tap-target-too-small",
  title: "Interactive element appears smaller than 44×44px",
  category: "a11y",
  defaultSeverity: "warning",
  fix: "Ensure padding + child size totals at least 44×44px (WCAG 2.5.5). Tailwind: `p-3` around `w-5 h-5` icons.",
});
defineRule({
  id: "a11y/outline-removed",
  title: "Focus outline removed without a replacement",
  category: "a11y",
  defaultSeverity: "error",
  fix: "Replace `outline:none` with a visible focus style (`focus:ring-2`, `focus-visible:outline-2`).",
});
defineRule({
  id: "a11y/onclick-on-div",
  title: "Click handler on non-interactive element",
  category: "a11y",
  defaultSeverity: "error",
  fix: "Use `<button>` or `<a>`. If you really need a div, add `role`, `tabIndex={0}`, and a keydown handler.",
});
// a11y/placeholder-as-label was consolidated into forms/label-above-not-placeholder.
defineRule({
  id: "a11y/lang-missing",
  title: "Root document missing `lang` attribute",
  category: "a11y",
  defaultSeverity: "warning",
  fix: "Set `<html lang=\"en\">` (or the actual primary language) in your layout/index template.",
});
defineRule({
  id: "a11y/autocomplete-missing",
  title: "Form field missing `autocomplete` hint",
  category: "a11y",
  defaultSeverity: "info",
  fix: "Add `autocomplete=\"name|email|tel|street-address|...\"` so password managers and mobile keyboards help users.",
});
defineRule({
  id: "a11y/heading-skip",
  title: "Heading levels skip within a single file",
  category: "a11y",
  defaultSeverity: "warning",
  fix: "Heading levels increase by exactly 1 (h1→h2→h3). Don't jump h2→h4.",
});

// =============================================================================
// forms/
// =============================================================================
defineRule({
  id: "forms/label-above-not-placeholder",
  title: "Form input uses placeholder as its only label",
  category: "forms",
  defaultSeverity: "warning",
  fix: "Always show a label above (or beside) the input. The placeholder vanishes when typing — it's not a substitute.",
});
defineRule({
  id: "forms/missing-inputmode",
  title: "Numeric/email/tel field missing `inputMode` or matching `type`",
  category: "forms",
  defaultSeverity: "info",
  fix: "Use `type=\"email|tel|number\"` or `inputMode=\"numeric|decimal|email|tel\"` so mobile keyboards switch correctly.",
});
defineRule({
  id: "forms/required-without-aria",
  title: "Field marked required visually but not programmatically",
  category: "forms",
  defaultSeverity: "info",
  fix: "Add `required` (or `aria-required={true}`) so screen readers announce the requirement.",
});
defineRule({
  id: "forms/error-not-associated",
  title: "Inline error message not associated with its field",
  category: "forms",
  defaultSeverity: "warning",
  fix: "Add `aria-describedby` from the input to the error element so assistive tech reads them together.",
});
defineRule({
  id: "forms/submit-without-loading-state",
  title: "Submit button doesn't disable or show loading on submit",
  category: "forms",
  defaultSeverity: "info",
  fix: "Disable the submit button or show a spinner while the request is in flight to prevent double-submit and feel responsive.",
});

// =============================================================================
// ui/
// =============================================================================
defineRule({
  id: "ui/missing-loading-state",
  title: "Component reads `isLoading`/`isPending` but never renders for it",
  category: "ui",
  defaultSeverity: "warning",
  fix: "Render a skeleton or spinner branch so users see something while data loads.",
});
defineRule({
  id: "ui/missing-error-state",
  title: "Component reads `error` but never renders for it",
  category: "ui",
  defaultSeverity: "warning",
  fix: "Render an error state with a recovery action — silent failures are the worst kind of bug for users.",
});
defineRule({
  id: "ui/missing-empty-state",
  title: "List rendered without an explicit empty branch",
  category: "ui",
  defaultSeverity: "info",
  fix: "Render an empty state with copy and a next-step CTA, not a blank panel.",
});

// =============================================================================
// inertia/
// =============================================================================
defineRule({
  id: "inertia/links-not-anchors",
  title: "Internal navigation uses <a href> instead of Inertia <Link>",
  category: "inertia",
  defaultSeverity: "info",
  fix: "Use `<Link href={...}>` for internal nav so the SPA router handles it. Keep `<a>` for external links.",
});
defineRule({
  id: "inertia/form-uses-useform",
  title: "Inertia page uses native <form onSubmit> instead of useForm",
  category: "inertia",
  defaultSeverity: "info",
  fix: "`useForm` carries CSRF tokens, surfaces server validation errors at `form.errors`, and tracks `processing` state.",
});
defineRule({
  id: "inertia/page-component-naming",
  title: "Inertia page component name doesn't match its `Inertia::render` string",
  category: "inertia",
  defaultSeverity: "warning",
  fix: "Keep page component file path aligned with `render inertia: \"Pages/Foo\"` so the router stays predictable.",
});

// =============================================================================
// tanstack/
// =============================================================================
defineRule({
  id: "tanstack/missing-error-component",
  title: "TanStack route has no errorComponent",
  category: "tanstack",
  defaultSeverity: "warning",
  fix: "Add `errorComponent: ({ error }) => ...` so loaders that throw don't render a blank screen.",
});
defineRule({
  id: "tanstack/missing-pending-component",
  title: "TanStack route has a loader but no pendingComponent",
  category: "tanstack",
  defaultSeverity: "info",
  fix: "Add `pendingComponent: () => <Skeleton />` so users see something while the loader runs.",
});
defineRule({
  id: "tanstack/search-validation",
  title: "Route reads search params without `validateSearch`",
  category: "tanstack",
  defaultSeverity: "warning",
  fix: "Add `validateSearch: (input) => ...` (Zod is common) so a malformed URL doesn't crash the page.",
});

// =============================================================================
// stack/
// =============================================================================
defineRule({
  id: "stack/devtools-in-prod",
  title: "Devtools imported without environment guard",
  category: "stack",
  defaultSeverity: "error",
  fix: "Wrap `<ReactQueryDevtools/>`, `<TanStackRouterDevtools/>`, etc. with `import.meta.env.DEV` so production users don't see them.",
});
defineRule({
  id: "stack/no-i18n-with-multilingual-strings",
  title: "App ships strings in multiple languages without an i18n library",
  category: "stack",
  defaultSeverity: "info",
  fix: "Adopt i18next/react-intl/lingui rather than maintaining parallel JSX trees per locale.",
});
defineRule({
  id: "stack/analyzer-failed",
  title: "Analyzer failed",
  category: "stack",
  defaultSeverity: "info",
});
