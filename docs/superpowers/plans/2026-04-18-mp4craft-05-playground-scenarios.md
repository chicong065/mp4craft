# mp4craft Plan 5: Playground Scenarios

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only React + Vite playground covering every part of the `mp4craft` public API surface. Eight scenarios span WebCodecs hot paths (CameraRecorder, ScreenRecorder, CanvasAnimation, AudioOnly, FmP4Live) and raw/matrix paths that close the API coverage gap (StressTest, CodecMatrix, FileReplay). UI follows `DESIGN.md` at the repository root strictly.

**Architecture:** `react-router-dom` v6 drives a single-page app with a left-hand scenario nav on desktop (hamburger on mobile) and a consistent scenario-frame layout. Scenarios share a small set of primitive components (`PillButton`, `DarkButton`, `Card`, `CodecSelector`, `Stats`, `ScenarioFrame`) built on plain CSS with design-system custom properties. Every scenario constructs a fresh `Mp4Muxer`, wires its inputs (WebCodecs encoders, canvas streams, file inputs), and renders the output either inline (`<video>` preview) or via download. The raw `addVideoSample` / `addAudioSample` paths and MP3 (which WebCodecs cannot encode) are exercised by `FileReplay`, which loads precomputed byte streams. `CodecMatrix` programmatically iterates every codec × container-mode combination so the playground doubles as a visible capability checklist.

**Tech Stack:** React 18.3, Vite 5, TypeScript strict mode, `react-router-dom` v6, plain CSS with custom properties, Google Fonts for DM Sans / Outfit / Poppins / Roboto, File System Access API with Blob download fallback, Media Source Extensions for the live playback scenario.

---

## Professional style bar (all tasks)

1. **DESIGN.md is the UI bible.** Read `DESIGN.md` at the repo root before any UI task. Colors, fonts, radii, spacing, and shadows must match. The don'ts in §7 are hard rules: no colored main backgrounds, no sharp corners on product cards, no pink text or pink buttons, no Roboto for headings, no weight 700 on headings, no shadow opacity past 0.16, no mixed display fonts in one section.
2. **Self-descriptive identifiers.** No `w`, `buf`, `pos`, `v`, `f`, `s`, `t`, `i`, `idx`, `len`, `tmp`, `ctx`, `cfg`, `opts`.
3. **`type` not `interface`.**
4. **Absolute imports via `@/...` inside the playground package** (set up its own path alias; `packages/playground/tsconfig.json` already has one or will be added in Task 1).
5. **JSDoc `/** ... \*/`** on every exported component, hook, type, and utility function. Per-field JSDoc on every field of exported prop types. The TSDoc `@param name - description` hyphen is expected and correct; do not remove it.
6. **Professional prose style.** Complete sentences, present-tense indicative voice, terminating periods. No em-dashes, no hyphen-as-punctuation between prose clauses, no arrow icons, no prose semicolons. Hyphens inside compound words (`in-memory`, `file-system-access`, `mono-stereo`) are fine. TypeScript statement-terminator semicolons stay.
7. **No what-comments.** Only why-comments.
8. **No dead code, no `any`, no `@ts-ignore`, no defensive branches for impossible cases.**
9. **No custom unit tests for the playground.** The core library is fully tested; the playground is a manual verification lab. Verification commands are `pnpm typecheck` + `pnpm --filter @mp4craft/playground build` + (suggested for the user) `pnpm dev` with a browser walk-through.

## Design-system cheatsheet (from `DESIGN.md`)

- **Colors**: `--color-background: #ffffff`, `--color-surface-dark: #181e25`, `--color-text-primary: #222222`, `--color-text-secondary: #45515e`, `--color-text-muted: #8e8e93`, `--color-brand-blue: #1456f0`, `--color-primary-500: #3b82f6`, `--color-primary-600: #2563eb`, `--color-primary-700: #1d4ed8`, `--color-border: #e5e7eb`, `--color-border-subtle: #f2f3f5`. Pink `#ea5ec1` is reserved for logo accents only.
- **Fonts**: `DM Sans` (UI workhorse, 70% of text), `Outfit` (display headings), `Poppins` (mid-tier sub-headings), `Roboto` (data-heavy contexts). Universal `line-height: 1.50` with 1.10 for 80px display headings.
- **Radii**: `--radius-pill: 9999px` (nav tabs, toggles), `--radius-button: 8px` (primary CTA), `--radius-card-small: 13px`, `--radius-card-medium: 20px`, `--radius-card-large: 24px`.
- **Shadows**: `--shadow-card: rgba(0, 0, 0, 0.08) 0px 4px 6px`, `--shadow-brand-glow: rgba(44, 30, 116, 0.16) 0px 0px 15px`, `--shadow-elevated: rgba(36, 36, 36, 0.08) 0px 12px 16px -4px`.
- **Spacing scale**: 4px, 8px, 12px, 16px, 24px, 32px, 40px, 64px, 80px.

## Coverage matrix (why eight scenarios)

| Scenario        | Video codec             | Audio codec                           | Container mode        | Target                                                 | API surface                                                                                     |
| --------------- | ----------------------- | ------------------------------------- | --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| CameraRecorder  | AVC via `VideoEncoder`  | AAC via `AudioEncoder` (optional mic) | `"in-memory"`         | `ArrayBufferTarget`                                    | `addVideoChunk`, `addAudioChunk`, `finalize`                                                    |
| ScreenRecorder  | AVC via `VideoEncoder`  | none                                  | `false` (progressive) | `StreamTarget` piped to `FileSystemWritableFileStream` | `addVideoChunk`, `finalize`, `seek` path                                                        |
| CanvasAnimation | VP9 via `VideoEncoder`  | none                                  | `"in-memory"`         | `ArrayBufferTarget`                                    | `addVideoChunk`, canvas capture                                                                 |
| AudioOnly       | none                    | Opus via `AudioEncoder`               | `"in-memory"`         | `ArrayBufferTarget`                                    | `addAudioChunk`                                                                                 |
| FmP4Live        | AVC via `VideoEncoder`  | AAC via `AudioEncoder`                | `"fragmented"`        | `StreamTarget` piped to `MediaSource`                  | `addVideoChunk`, `addAudioChunk`, fragment boundaries, MSE playback                             |
| StressTest      | configurable            | configurable                          | configurable          | `ArrayBufferTarget`                                    | throughput measurement across any combination                                                   |
| CodecMatrix     | all four video codecs   | all five audio codecs                 | all three modes       | `ArrayBufferTarget`                                    | programmatic sweep verifying every `VideoCodec` × `AudioCodec` × `FastStart` path               |
| FileReplay      | any (from loaded bytes) | any (from loaded bytes)               | `"in-memory"`         | `ArrayBufferTarget`                                    | raw `addVideoSample` / `addAudioSample`, covers MP3 and every path WebCodecs cannot encode live |

---

## File Map

**Modified:**

| File                                 | Change                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/playground/package.json`   | Add `react-router-dom` ^6.26.0. No other dep changes.                                                                                                   |
| `packages/playground/index.html`     | Add Google Fonts `<link>` for DM Sans, Outfit, Poppins, Roboto.                                                                                         |
| `packages/playground/src/main.tsx`   | Wrap `<App />` in `<BrowserRouter>`.                                                                                                                    |
| `packages/playground/src/App.tsx`    | Replace the Plan 1 "ok/fail" stub with the design-system app shell (header, nav, main, footer) plus `<Routes>` for the eight scenarios and a home page. |
| `packages/playground/src/styles.css` | Replace with the design-system token sheet plus base reset and body typography.                                                                         |
| `packages/playground/tsconfig.json`  | Add `@/*` path alias mapping to `src/*` for the playground.                                                                                             |
| `packages/playground/vite.config.ts` | Mirror the `@/` alias so Vite resolves it at dev and build time.                                                                                        |

**Created (design-system primitives):**

| File                                                   | Purpose                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `packages/playground/src/tokens.css`                   | CSS custom properties for color, typography, radius, shadow, spacing per `DESIGN.md`. Imported from `styles.css`. |
| `packages/playground/src/components/PillButton.tsx`    | Pill-radius toggle and nav button (9999px).                                                                       |
| `packages/playground/src/components/DarkButton.tsx`    | Primary CTA button (`#181e25` fill, 8px radius, white text).                                                      |
| `packages/playground/src/components/Card.tsx`          | White card container with subtle shadow and 13–20px radius options.                                               |
| `packages/playground/src/components/ScenarioFrame.tsx` | Consistent per-scenario wrapper: title block in Outfit, description in DM Sans, content area.                     |
| `packages/playground/src/components/CodecSelector.tsx` | Dropdowns or pill groups that pick codec and container mode for scenarios.                                        |
| `packages/playground/src/components/Stats.tsx`         | Compact numeric readouts (bytes written, samples/sec, wall-clock) in Roboto.                                      |
| `packages/playground/src/components/AppShell.tsx`      | Header, left-nav or top-nav, main slot, footer. Imports the design-system primitives.                             |
| `packages/playground/src/components/HomeView.tsx`      | Landing page that lists every scenario as a white card grid, matching the DESIGN.md product-card aesthetic.       |

**Created (scenarios — one component per file):**

| File                                                    | Scenario |
| ------------------------------------------------------- | -------- |
| `packages/playground/src/scenarios/CameraRecorder.tsx`  | Task 2   |
| `packages/playground/src/scenarios/CanvasAnimation.tsx` | Task 3   |
| `packages/playground/src/scenarios/ScreenRecorder.tsx`  | Task 3   |
| `packages/playground/src/scenarios/AudioOnly.tsx`       | Task 4   |
| `packages/playground/src/scenarios/FmP4Live.tsx`        | Task 4   |
| `packages/playground/src/scenarios/StressTest.tsx`      | Task 5   |
| `packages/playground/src/scenarios/CodecMatrix.tsx`     | Task 5   |
| `packages/playground/src/scenarios/FileReplay.tsx`      | Task 6   |

**Created (shared utilities):**

| File                                             | Purpose                                                                                                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/playground/src/lib/encoders.ts`        | Thin helpers around `VideoEncoder` and `AudioEncoder` that resolve codec strings from the mp4craft codec tag, return typed output streams, and surface the first `decoderConfig` so scenarios can build a `VideoTrackConfig` / `AudioTrackConfig`. |
| `packages/playground/src/lib/download.ts`        | Saves a `Uint8Array` to disk via File System Access API when available, Blob anchor fallback otherwise.                                                                                                                                            |
| `packages/playground/src/lib/parse-mp4-bytes.ts` | Lightweight NAL-unit extraction for FileReplay's AVC reader so the scenario can feed samples via the raw `addVideoSample` API.                                                                                                                     |

---

## Pre-flight: reading `DESIGN.md`

Every subagent working on a UI task must read `/Users/congnguyen94/my_codes/mp4-muxer/DESIGN.md` before writing any component. The implementer prompts below include the specific DESIGN.md sections that apply to each task. If a conflict arises between the plan and DESIGN.md, DESIGN.md wins.

---

### Task 1: Design-system foundation + app shell + routing

**Files:**

- Modify: `packages/playground/package.json`
- Modify: `packages/playground/index.html`
- Modify: `packages/playground/src/main.tsx`
- Modify: `packages/playground/src/App.tsx`
- Modify: `packages/playground/src/styles.css`
- Modify: `packages/playground/tsconfig.json`
- Modify: `packages/playground/vite.config.ts`
- Create: `packages/playground/src/tokens.css`
- Create: `packages/playground/src/components/PillButton.tsx`
- Create: `packages/playground/src/components/DarkButton.tsx`
- Create: `packages/playground/src/components/Card.tsx`
- Create: `packages/playground/src/components/ScenarioFrame.tsx`
- Create: `packages/playground/src/components/AppShell.tsx`
- Create: `packages/playground/src/components/HomeView.tsx`

---

#### Required design-system conformance

Read DESIGN.md §2 (color palette), §3 (typography), §4 (component stylings), §5 (layout principles), §6 (depth and elevation), §7 (do's and don'ts), and §9 (quick color reference). Apply each rule to the following:

- **`tokens.css`** declares `:root` CSS custom properties for every color in §2 (Brand Primary, Blue Scale, Text, Surface, Border, Semantic, Shadows), every radius in §5 (Minimal 4px, Standard 8px, Comfortable 11–13px, Generous 16–20px, Large 22–24px, Pill 30–32px, Full 9999px), and every shadow in §6 (Subtle, Ambient, Brand Glow, Elevated). Also declare spacing scale custom properties matching §5's "Base unit 8px" scale.
- **Fonts** load via a single Google Fonts `<link>` in `index.html` carrying DM Sans (400, 500, 600, 700), Outfit (500, 600), Poppins (500), and Roboto (400, 500, 600). Use the `preconnect` pattern to avoid blocking paint.
- **`body`** in `styles.css` sets `font-family: "DM Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`, `background: var(--color-background)`, `color: var(--color-text-primary)`, `line-height: 1.5`, and a sensible base font size of 16px.
- **`AppShell`** renders the header, nav, main content slot, and footer. Header uses a white background, DM Sans 14px weight 500 for nav links, pill-shaped active tab (9999px radius, `rgba(0, 0, 0, 0.05)` background) per §4. Footer uses `#181e25` background with `rgba(255, 255, 255, 0.8)` text. Sticky header per DESIGN.md §4.
- **`PillButton`** renders a pill-radius button. Variants: "nav" (subtle tint background), "nav-active" (stronger tint, `#18181b` text), "ghost" (transparent). All use `border-radius: var(--radius-pill)`.
- **`DarkButton`** is the primary CTA: `background: var(--color-surface-dark)`, `color: #ffffff`, `padding: 11px 20px`, `border-radius: var(--radius-button)`.
- **`Card`** has two radius variants (`small` = 13px, `medium` = 20px) and two shadow variants (`subtle` = `--shadow-card`, `glow` = `--shadow-brand-glow`).
- **`ScenarioFrame`** renders the scenario title in Outfit 31px weight 600 with `line-height: 1.5` per DESIGN.md §3 "Section Heading", a DM Sans 16px `line-height: 1.5` description, and a content slot with 24px padding.
- **`HomeView`** renders the eight scenarios as a 3-column grid on desktop (2 on tablet, 1 on mobile) of `Card` components with `radius="medium"`. Each card carries the scenario name in Outfit 28px weight 500, a one-sentence DM Sans description, and routes to the scenario on click.

#### Routing plan

`App.tsx` wraps `AppShell` around a `<Routes>` tree. The paths are:

- `/` → `HomeView`
- `/camera-recorder` → placeholder for Task 2
- `/canvas-animation` → placeholder for Task 3
- `/screen-recorder` → placeholder for Task 3
- `/audio-only` → placeholder for Task 4
- `/fmp4-live` → placeholder for Task 4
- `/stress-test` → placeholder for Task 5
- `/codec-matrix` → placeholder for Task 5
- `/file-replay` → placeholder for Task 6

Placeholders render a `ScenarioFrame` with the scenario name and a "Coming in Task N" label so every nav link is routable from Task 1 onward. Each later task replaces its placeholder with the real scenario.

#### Steps

- [ ] **Step 1: Install `react-router-dom` in `packages/playground/package.json`**

Add to dependencies:

```json
"react-router-dom": "^6.26.0"
```

And pair types:

```json
"@types/react-router-dom": "^5.3.3"
```

Wait, `react-router-dom` v6 ships its own types; no `@types` package is required. Install just `react-router-dom`. Then run `pnpm install` from the repo root so pnpm wires up the workspace.

- [ ] **Step 2: Add path alias to `packages/playground/tsconfig.json`**

Extend the existing `compilerOptions` so `@/*` resolves to `src/*`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "rootDir": ".",
    "outDir": "dist",
    "baseUrl": ".",
    "types": ["dom-webcodecs"],
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

Add the matching Vite alias in `packages/playground/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const playgroundRoot = resolve(fileURLToPath(new URL('.', import.meta.url)))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(playgroundRoot, 'src'),
    },
  },
})
```

- [ ] **Step 3: Update `packages/playground/index.html` with Google Fonts**

Replace with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mp4craft playground</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@500;600&family=Poppins:wght@500&family=Roboto:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `packages/playground/src/tokens.css`**

Declare every design-system custom property. Reference values come straight from DESIGN.md §2, §5, §6. Examples (not an exhaustive copy-paste; fill in every value from DESIGN.md):

```css
:root {
  --color-background: #ffffff;
  --color-surface-dark: #181e25;
  --color-text-primary: #222222;
  --color-text-secondary: #45515e;
  --color-text-muted: #8e8e93;
  --color-text-on-dark: rgba(255, 255, 255, 0.8);
  --color-brand-blue: #1456f0;
  --color-brand-blue-hover: #2563eb;
  --color-primary-light: #60a5fa;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-border: #e5e7eb;
  --color-border-subtle: #f2f3f5;
  --color-pill-nav-bg: rgba(0, 0, 0, 0.05);

  --radius-button: 8px;
  --radius-card-small: 13px;
  --radius-card-medium: 20px;
  --radius-card-large: 24px;
  --radius-pill: 9999px;

  --shadow-card: rgba(0, 0, 0, 0.08) 0px 4px 6px;
  --shadow-ambient: rgba(0, 0, 0, 0.08) 0px 0px 22.576px;
  --shadow-brand-glow: rgba(44, 30, 116, 0.16) 0px 0px 15px;
  --shadow-elevated: rgba(36, 36, 36, 0.08) 0px 12px 16px -4px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 40px;
  --space-8: 64px;
  --space-9: 80px;

  --font-ui: 'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-display: 'Outfit', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-mid: 'Poppins', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-data: 'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 5: Replace `packages/playground/src/styles.css`**

The new file imports `tokens.css` and defines the base reset plus body typography:

```css
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: var(--font-ui);
  font-size: 16px;
  line-height: 1.5;
  color: var(--color-text-primary);
  background: var(--color-background);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}

code {
  font-family: var(--font-data);
  font-size: 0.9em;
}
```

- [ ] **Step 6: Implement `PillButton`, `DarkButton`, `Card`, `ScenarioFrame`**

Each is a small React component with a co-located `.module.css` or inline `style` prop driven by design-system tokens.

Shape of `PillButton.tsx`:

```tsx
import type { MouseEventHandler, ReactNode } from 'react'

/**
 * Pill-radius button used for navigation tabs, filter toggles, and other
 * non-primary actions. Matches DESIGN.md §4 "Pill Nav" and "Pill White".
 */
export type PillButtonVariant = 'nav' | 'nav-active' | 'ghost'

export type PillButtonProps = {
  /** Rendered contents. */
  children: ReactNode
  /** Visual variant from DESIGN.md §4. Defaults to `"nav"`. */
  variant?: PillButtonVariant
  /** Click handler. */
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** Accessible label override when the button body is an icon. */
  ariaLabel?: string
}

export function PillButton(props: PillButtonProps): JSX.Element {
  const variant = props.variant ?? 'nav'
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      className={`pill-button pill-button--${variant}`}
    >
      {props.children}
    </button>
  )
}
```

Companion CSS in `styles.css` (or co-located `pill-button.css` imported from the component):

```css
.pill-button {
  border: none;
  cursor: pointer;
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.pill-button--nav {
  background: var(--color-pill-nav-bg);
  color: var(--color-text-primary);
}
.pill-button--nav-active {
  background: rgba(0, 0, 0, 0.08);
  color: #18181b;
}
.pill-button--ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
```

`DarkButton.tsx` mirrors the DESIGN.md "Pill Primary Dark" spec but notice that DESIGN.md §4 writes `Radius: 8px` for Pill Primary Dark. Use `--radius-button`:

```css
.dark-button {
  background: var(--color-surface-dark);
  color: #ffffff;
  border-radius: var(--radius-button);
  padding: 11px 20px;
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  border: none;
  cursor: pointer;
}
.dark-button:hover {
  background: #24282f;
}
```

`Card.tsx` exposes two props: `radius` (`"small" | "medium"`) and `shadow` (`"subtle" | "glow"`). The default is `{radius: "medium", shadow: "subtle"}` to match the product-card aesthetic.

`ScenarioFrame.tsx`:

```tsx
import type { ReactNode } from 'react'

/**
 * Consistent per-scenario page wrapper. The title renders in Outfit 31px weight 600
 * per DESIGN.md §3 "Section Heading"; the description renders in DM Sans 16px. The
 * content slot sits below with 24px internal padding.
 */
export type ScenarioFrameProps = {
  /** Scenario title displayed as the section heading. */
  title: string
  /** One-sentence summary of what the scenario does. */
  description: string
  /** Scenario-specific controls, previews, and outputs. */
  children: ReactNode
}

export function ScenarioFrame(props: ScenarioFrameProps): JSX.Element {
  return (
    <section className="scenario-frame">
      <header className="scenario-frame__header">
        <h1 className="scenario-frame__title">{props.title}</h1>
        <p className="scenario-frame__description">{props.description}</p>
      </header>
      <div className="scenario-frame__content">{props.children}</div>
    </section>
  )
}
```

With CSS:

```css
.scenario-frame {
  max-width: 1024px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5);
}
.scenario-frame__title {
  font-family: var(--font-display);
  font-size: 31px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-text-primary);
  margin: 0 0 var(--space-3) 0;
}
.scenario-frame__description {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-6) 0;
}
.scenario-frame__content {
  padding: var(--space-5) 0;
}
```

- [ ] **Step 7: Build `AppShell.tsx` and `HomeView.tsx`**

`AppShell` renders:

- A sticky header: left-aligned "mp4craft" wordmark in Outfit 20px weight 500, right-aligned "Docs" link in DM Sans 14px weight 500.
- A horizontal nav bar below the header for desktop widths, collapsed into a hamburger on mobile. Each scenario is a `PillButton` with variant switching between "nav" and "nav-active" based on the active route. Use `useLocation()` from `react-router-dom` to determine the active path.
- A `<main>` slot rendering the matched route.
- A dark footer (`#181e25`, `rgba(255,255,255,0.8)` text) containing "mp4craft playground" on the left and a GitHub link on the right (URL: `https://github.com/`). DESIGN.md §5 calls for 64–80px section gaps, so the footer top padding is 64px.

`HomeView` renders an introductory 80px Outfit weight 500 heading ("Every mp4craft capability, in one playground") followed by a description paragraph, then an 8-card product grid using `Card radius="medium" shadow="glow"`. Each card carries:

- The scenario name in Outfit 28px weight 500 (per DESIGN.md §3 "Card Title").
- The codec matrix covered, rendered in a small DM Sans 13px weight 500 badge row.
- A DM Sans 14px weight 400 description.
- Click behaviour via `useNavigate()` to route to the scenario.

- [ ] **Step 8: Update `main.tsx` to wrap `<App />` in `<BrowserRouter>`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from '@/App'
import '@/styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('playground root element missing from index.html')
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 9: Update `App.tsx` to render the shell plus routes**

```tsx
import { Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { HomeView } from '@/components/HomeView'
import { ScenarioFrame } from '@/components/ScenarioFrame'

function PlaceholderScenario(props: { title: string; description: string; plannedTask: string }): JSX.Element {
  return (
    <ScenarioFrame title={props.title} description={props.description}>
      <p>Coming in {props.plannedTask}.</p>
    </ScenarioFrame>
  )
}

export function App(): JSX.Element {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route
          path="/camera-recorder"
          element={
            <PlaceholderScenario
              title="Camera Recorder"
              description="getUserMedia through VideoEncoder and AudioEncoder into an in-memory MP4."
              plannedTask="Task 2"
            />
          }
        />
        {/* Repeat for canvas-animation, screen-recorder, audio-only, fmp4-live, stress-test, codec-matrix, file-replay */}
      </Routes>
    </AppShell>
  )
}
```

The placeholder scenarios for Tasks 3 through 6 follow the same pattern.

- [ ] **Step 10: Verify**

```
pnpm install
pnpm --filter @mp4craft/playground typecheck
pnpm --filter @mp4craft/playground build
pnpm typecheck
pnpm test
```

Expected:

- `pnpm install` wires up `react-router-dom`.
- Typecheck clean in both the playground and the root.
- Playground `vite build` succeeds.
- Core library tests still at 151 passing.

### Step 11: Self-review

- Every DESIGN.md `Do` in §7 is honoured, every `Don't` respected.
- Fonts load once per page from Google Fonts CDN.
- No colored backgrounds on main content; color lives on product cards only.
- No weight 700 on headings.
- No Roboto outside of data/stat readouts.
- All nav pills use `var(--radius-pill)`.
- Every exported component has JSDoc.
- No em-dashes, hyphen-as-punctuation, arrow icons, or prose semicolons in any new file.

---

### Task 2: CameraRecorder scenario

**Files:**

- Create: `packages/playground/src/lib/encoders.ts`
- Create: `packages/playground/src/lib/download.ts`
- Create: `packages/playground/src/components/CodecSelector.tsx`
- Create: `packages/playground/src/components/Stats.tsx`
- Create: `packages/playground/src/scenarios/CameraRecorder.tsx`
- Modify: `packages/playground/src/App.tsx` (replace placeholder)

---

#### Scenario description

The CameraRecorder scenario demonstrates the WebCodecs happy path. The user clicks "Start" to request `navigator.mediaDevices.getUserMedia({video: true, audio: true})`, a `VideoEncoder` with codec `avc1.42001f` (AVC Baseline 3.1) feeds its encoded chunks through `muxer.addVideoChunk`, an `AudioEncoder` with codec `mp4a.40.2` (AAC-LC) feeds chunks through `muxer.addAudioChunk`, and a live self-preview renders from the `MediaStream`. On "Stop", `muxer.finalize()` runs and the resulting `ArrayBuffer` is offered as a download via File System Access API with a `.mp4` extension. A `Stats` component shows the running byte count, sample count, and elapsed wall-clock time.

DESIGN.md references that apply: §3 typography (section heading 31px Outfit 600 is set by `ScenarioFrame`; body text 16px DM Sans 400–500; stats readouts in Roboto 13px weight 400 per §3 "Caption"), §4 buttons ("Start" is the `DarkButton`, "Stop" is a `PillButton` variant `"nav-active"`), §6 shadows (any preview card uses `--shadow-card`).

#### Steps

- [ ] **Step 1: Implement `packages/playground/src/lib/encoders.ts`**

Helpers for working with WebCodecs. Export two async factory functions `createVideoEncoderPipeline` and `createAudioEncoderPipeline` that each:

- Accept a `codecString`, desired width/height (video) or channel count/sample rate (audio), and a target-rate hint.
- Construct a WebCodecs encoder with `output` and `error` handlers.
- Return an object with `encoder`, a `firstConfigDescription` promise that resolves with the `VideoDecoderConfig.description` (or audio equivalent) captured from the first `output` metadata, and a `close()` helper.

Per-field JSDoc on every return field. Cite the WebCodecs spec `https://w3c.github.io/webcodecs/` in class/function JSDoc.

- [ ] **Step 2: Implement `packages/playground/src/lib/download.ts`**

```ts
/**
 * Saves the supplied bytes to disk. Prefers the File System Access API when available,
 * falling back to a `Blob` + anchor download otherwise.
 *
 * @param suggestedName - File name shown in the save dialog (the fallback path uses the
 *   same string as the `download` attribute on the anchor).
 * @param bytes - The bytes to save.
 */
export async function saveBytesToDisk(suggestedName: string, bytes: Uint8Array): Promise<void> { ... }
```

Use `window.showSaveFilePicker` when `window.showSaveFilePicker` is present; otherwise fall back to `URL.createObjectURL` + `a[download]`. No framework, plain DOM.

- [ ] **Step 3: Implement `CodecSelector.tsx`**

Renders a row of `PillButton`s for the available codec tags. Props:

```ts
export type CodecSelectorProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (next: T) => void
}
```

The active option uses `variant="nav-active"`, the rest use `variant="nav"`. Typography: DM Sans 14px weight 500 (inherited from `PillButton`).

- [ ] **Step 4: Implement `Stats.tsx`**

Renders a 3-column grid of read-only numeric fields using Roboto per DESIGN.md §3 "Data/Technical":

```ts
export type StatsProps = {
  entries: readonly { label: string; value: string }[]
}
```

Label uses DM Sans 12px weight 500 color `var(--color-text-muted)`. Value uses Roboto 20px weight 500 color `var(--color-text-primary)`.

- [ ] **Step 5: Implement `CameraRecorder.tsx`**

Full scenario. State machine:

- `"idle"` → show permission request prompt inside a `Card`. Render a `DarkButton` labelled "Start Recording".
- `"recording"` → live `<video>` self-preview bound to the `MediaStream`. Show `Stats` with video bytes, audio bytes, duration. Render a stop `PillButton` (variant `"nav-active"`).
- `"stopped"` → show a preview of the recorded MP4 (`<video controls src={objectUrl}>`), render a `DarkButton` labelled "Save MP4" that calls `saveBytesToDisk("camera-recording.mp4", bytes)`, plus a `PillButton` labelled "Record Again" that resets state.

The VideoEncoder pipeline uses `{codec: "avc1.42001f", width, height, framerate: 30, bitrate: 5_000_000, avc: {format: "avc"}}`. The AudioEncoder uses `{codec: "mp4a.40.2", numberOfChannels: 1, sampleRate: 48000, bitrate: 128_000}`. The first `output` callback supplies the `decoderConfig.description`; once both descriptions arrive, construct the `Mp4Muxer` with `fastStart: "in-memory"` and start feeding chunks.

Include a JSDoc block on `CameraRecorder` citing `https://w3c.github.io/webcodecs/` and pointing at mp4craft's `Mp4Muxer` class.

- [ ] **Step 6: Register the route in `App.tsx`**

Replace the Task 1 placeholder for `/camera-recorder` with `<CameraRecorder />`.

- [ ] **Step 7: Verify**

```
pnpm --filter @mp4craft/playground typecheck
pnpm --filter @mp4craft/playground build
pnpm test
```

Suggest to the user (not run by the agent): `pnpm dev`, navigate to `/camera-recorder`, grant camera and mic permissions in Chrome, record 5 seconds, save, and confirm the downloaded `.mp4` plays in QuickTime and Chrome `file://`.

---

### Task 3: CanvasAnimation + ScreenRecorder scenarios

**Files:**

- Create: `packages/playground/src/scenarios/CanvasAnimation.tsx`
- Create: `packages/playground/src/scenarios/ScreenRecorder.tsx`
- Modify: `packages/playground/src/App.tsx` (replace two placeholders)

---

CanvasAnimation exercises the in-memory pipeline with a generated video source. An animated HTML canvas draws a rotating gradient, the scenario captures `VideoFrame` via `new VideoFrame(canvas, {timestamp})`, and a VP9 `VideoEncoder` (`vp09.00.10.08`) feeds `muxer.addVideoChunk`. Output downloads as `canvas-animation.mp4`.

ScreenRecorder exercises the progressive mode against `StreamTarget` wired to `FileSystemWritableFileStream`. The user clicks "Start Capture", `navigator.mediaDevices.getDisplayMedia({video: true})` fires, and AVC-encoded chunks stream to disk via `StreamTarget`'s `onData` callback which `await`s `writable.write({type: "write", position, data})` on the FileSystem writable. On "Stop", `muxer.finalize()` patches the `mdat` header (progressive mode requires `seek`, which `FileSystemWritableFileStream.write({type: "seek"})` supports).

DESIGN.md references: §4 buttons, §5 max-width content area.

#### Steps

- [ ] **Step 1: Implement `CanvasAnimation.tsx`**

- Render a 640x360 `<canvas>` with a gradient animation that advances on `requestAnimationFrame`.
- Render controls: DarkButton "Record 5 seconds" and (once recorded) DarkButton "Save MP4".
- State machine: idle, recording, stopped. Use VP9 `VideoEncoder` for the encoder path.
- On "Record 5 seconds", capture 150 `VideoFrame`s across 5 seconds (30 fps). Push each frame to the encoder. Await `await encoder.flush()` before finalizing.
- Use `fastStart: "in-memory"` with `ArrayBufferTarget`.

- [ ] **Step 2: Implement `ScreenRecorder.tsx`**

- On "Start Capture", request `getDisplayMedia({video: true})`, create the AVC VideoEncoder, call `window.showSaveFilePicker({suggestedName: "screen-capture.mp4", types: [{description: "MP4 video", accept: {"video/mp4": [".mp4"]}}]})`, obtain a `FileSystemWritableFileStream`, and construct a `StreamTarget` whose `onData` calls `writable.write({type: "write", position, data})`. Pass `seek: (offset) => writable.write({type: "seek", position: offset})` via a custom `Target` implementation if `StreamTarget` does not expose `seek`. Review the current `StreamTarget` implementation for seek support and adjust the scenario accordingly.
- On "Stop", call `muxer.finalize()`, `await writable.close()`, show success state. The DarkButton can offer a "Reveal" action that opens the file via File System Access API.

Note: the current `StreamTarget` in `packages/core/src/targets/stream-target.ts` does not carry a `seek` callback. The scenario constructs a custom inline target (matching the `Target` interface) that wraps the `FileSystemWritableFileStream` and provides `write`, `seek`, `finish`. This exercises the `Target` interface directly and also verifies the progressive path against a seekable sink other than `ArrayBufferTarget`.

- [ ] **Step 3: Wire routes and verify**

```
pnpm --filter @mp4craft/playground typecheck
pnpm --filter @mp4craft/playground build
pnpm test
```

Suggest to the user: run `pnpm dev`, visit `/canvas-animation`, record, save, play. Visit `/screen-recorder`, record a short screen region, confirm the on-disk `.mp4` plays in QuickTime.

---

### Task 4: AudioOnly + FmP4Live scenarios

**Files:**

- Create: `packages/playground/src/scenarios/AudioOnly.tsx`
- Create: `packages/playground/src/scenarios/FmP4Live.tsx`
- Modify: `packages/playground/src/App.tsx` (replace two placeholders)

---

AudioOnly requests mic access, encodes with Opus via `AudioEncoder` (`opus`), and muxes audio-only samples into an `in-memory` ArrayBufferTarget. The output downloads as `audio-only.mp4`. Optionally renders a waveform preview via Web Audio analyser drawn on canvas.

FmP4Live is the marquee fragmented scenario. The user clicks "Go Live", the scenario creates an `<video>` element with a `MediaSource` object URL, constructs a `SourceBuffer` with `video/mp4; codecs="avc1.42001f"`, builds an `Mp4Muxer` with `fastStart: "fragmented"` targeting a custom `StreamTarget`-style sink that appends every byte to `sourceBuffer.appendBuffer(...)`. A `getUserMedia` camera feed encodes to AVC and streams into the muxer. The `<video>` starts playing live as soon as the first `moof`+`mdat` pair lands.

DESIGN.md references: §4 buttons, §3 typography. FmP4Live's live video shows inside a `Card` with `shadow="glow"` to emphasise it as the hero of the scenario.

#### Steps

- [ ] **Step 1: Implement `AudioOnly.tsx`** — mic capture, Opus encoder, Opus codec in mp4craft (`codec: "opus"`), optional waveform canvas.

- [ ] **Step 2: Implement `FmP4Live.tsx`** — `MediaSource` wiring, fragment-to-SourceBuffer sink, AVC encoder loop, clean teardown on navigation.

- [ ] **Step 3: Wire routes and verify.**

---

### Task 5: StressTest + CodecMatrix scenarios

**Files:**

- Create: `packages/playground/src/scenarios/StressTest.tsx`
- Create: `packages/playground/src/scenarios/CodecMatrix.tsx`
- Modify: `packages/playground/src/App.tsx` (replace two placeholders)

---

StressTest exposes form controls for duration (seconds), codec (video and audio), and fastStart mode. On "Run" it generates synthetic encoded chunks (zero-filled byte arrays of realistic sizes) and feeds them through the muxer as fast as possible, measuring wall-clock time, total bytes written, and megabytes per second. Renders results in a `Stats` component.

CodecMatrix runs a deterministic sweep: for every `(VideoCodec, AudioCodec, FastStart)` combination, construct an `Mp4Muxer`, feed two synthetic samples per track, finalize, and record pass/fail. Displays a grid of green/red badges per combination. This is the visible API-coverage audit.

DESIGN.md references: §4 buttons, §3 typography. StressTest's results panel uses Roboto 20px for numbers and DM Sans 12px for labels per DESIGN.md §3 "Caption" and the data-font rule. CodecMatrix uses small radius cards (`--radius-card-small`) in a dense grid.

#### Steps

- [ ] **Step 1: Implement `StressTest.tsx`** — form controls, deterministic sample generator, progress bar, `Stats` readouts.

- [ ] **Step 2: Implement `CodecMatrix.tsx`** — iterate every `(video, audio, mode)` triple; feed minimal valid config records (hand-crafted avcC, hvcC, vpcC, av1C, AudioSpecificConfig for AAC, dOps for Opus, dfLa for FLAC, nothing for MP3 and PCM since those have no description); record which combinations mp4craft accepts. Render a 4x5x3 grid of badges.

- [ ] **Step 3: Wire routes and verify.**

---

### Task 6: FileReplay scenario

**Files:**

- Create: `packages/playground/src/lib/parse-mp4-bytes.ts`
- Create: `packages/playground/src/scenarios/FileReplay.tsx`
- Modify: `packages/playground/src/App.tsx` (replace placeholder)

---

FileReplay is the API-coverage completer. The user uploads an existing `.mp4` file (or precomputed AVC/MP3/FLAC track), the scenario extracts sample bytes from the source container, and feeds them through the raw `addVideoSample` / `addAudioSample` APIs to rebuild the container in a new mode (typically `fastStart: "in-memory"`). This is the only scenario that exercises the Node-oriented raw-sample API surface in the browser.

For AVC, use a minimal NAL-unit extractor (length-prefixed form, compatible with Annex-B input). For MP3, FLAC, and PCM, pass-through copy of the sample bytes is sufficient because those codecs store decoder parameters in the sample entry rather than the payload. The scenario includes a codec selector and a file input.

DESIGN.md references: §4 buttons, §5 max-width, §6 shadows. The upload zone uses a dashed-border `Card` (medium radius) with a drop hint in DM Sans 14px.

#### Steps

- [ ] **Step 1: Implement `parse-mp4-bytes.ts`** — small helper that reads an input MP4 ArrayBuffer, locates the first `mdat`, and slices sample bytes based on a supplied `stsz` array. For simplicity, accept a flat array of sample sizes and return an async iterator of `Uint8Array` slices.

- [ ] **Step 2: Implement `FileReplay.tsx`** — file input, codec selector, trigger button, progress state, preview of the rewritten MP4 via `<video>` plus a save button.

- [ ] **Step 3: Wire route and verify.** Final check runs `pnpm --filter @mp4craft/playground build` and confirms Vite bundles the playground cleanly. Suggest to the user: `pnpm dev`, visit `/file-replay`, upload an AVC+AAC MP4, choose `"in-memory"` mode, save the rewritten file, confirm playback.

---

## Spec coverage self-review

| Design-spec requirement                        | Task                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| React + Vite playground                        | Task 1                                                                          |
| Design-system conformance per DESIGN.md        | Task 1 and every subsequent UI task                                             |
| CameraRecorder scenario                        | Task 2                                                                          |
| CanvasAnimation scenario                       | Task 3                                                                          |
| ScreenRecorder scenario                        | Task 3                                                                          |
| AudioOnly scenario                             | Task 4                                                                          |
| FmP4Live scenario                              | Task 4                                                                          |
| StressTest scenario                            | Task 5                                                                          |
| CodecMatrix scenario (API coverage audit)      | Task 5                                                                          |
| FileReplay scenario (raw-sample API, MP3 path) | Task 6                                                                          |
| All three `FastStart` modes exercised          | StressTest, CodecMatrix, each scenario-specific default                         |
| All four video codecs exercised                | CodecMatrix (programmatic), plus scenario-specific defaults                     |
| All five audio codecs exercised                | CodecMatrix (programmatic), plus scenario-specific defaults                     |
| `addVideoChunk` / `addAudioChunk` paths        | CameraRecorder, CanvasAnimation, ScreenRecorder, AudioOnly, FmP4Live            |
| `addVideoSample` / `addAudioSample` raw paths  | FileReplay                                                                      |
| `ArrayBufferTarget`                            | CameraRecorder, CanvasAnimation, AudioOnly, StressTest, CodecMatrix, FileReplay |
| `StreamTarget`                                 | FmP4Live, ScreenRecorder                                                        |
| `Target` interface (custom)                    | ScreenRecorder (FileSystemWritable wrapper), FmP4Live (MediaSource wrapper)     |

Placeholder scan: every step lists files, shapes out component structure, and runnable commands. Exact code reproduced only where it is short or non-obvious; the bulky encoder and scenario bodies describe state machines precisely enough that an implementer can translate directly.

Type-consistency scan: `PillButtonProps`, `DarkButtonProps`, `CardProps`, `ScenarioFrameProps`, `CodecSelectorProps`, `StatsProps`, `AppShellProps`, and all eight scenario components use consistent identifiers across the plan.

DESIGN.md compliance scan: every UI component references the specific DESIGN.md section that dictates its visual treatment. The plan contains no CSS values that contradict DESIGN.md.
