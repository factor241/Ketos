# Theme and Template Button Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the sidebar theme control animation and keep all Russian welcome-template labels contained and visually centered.

**Architecture:** Keep the existing state and callbacks. Make the theme indicator the only selected background layer, coordinate its transform with label-color transitions, and give all template buttons one shared responsive grid geometry with a balancing spacer opposite the icon.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Jest 30, React Testing Library.

## Global Constraints

- Theme storage and selection behavior remain unchanged.
- Initial theme render remains animation-free.
- Translation wording and starter-template callbacks remain unchanged.
- Template labels may wrap but must never overflow or clip.

---

### Task 1: Theme segmented-control animation

**Files:**
- Modify: `src/frontend/src/components/core/appHeaderComponent/components/ThemeButtons/index.tsx`
- Test: `src/frontend/src/components/core/appHeaderComponent/components/ThemeButtons/__tests__/theme-buttons.test.tsx`

**Interfaces:**
- Consumes: `ThemePreference` and `setThemePreference(theme)` from `use-custom-theme`.
- Produces: the existing `ThemeButtons` component with one `data-testid="theme-selection-indicator"` background owner.

- [ ] **Step 1: Write the failing test**

Add an assertion that the indicator owns `transition-transform duration-[180ms] ease-out` after interaction and the selected dark/menu buttons do not own a `bg-*` selected background.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/core/appHeaderComponent/components/ThemeButtons/__tests__/theme-buttons.test.tsx --runInBand`

Expected: FAIL because the indicator has no test id/coordinated transition and the selected controls still paint independent backgrounds.

- [ ] **Step 3: Write minimal implementation**

Add `data-testid="theme-selection-indicator"`, use `transition-transform duration-[180ms] ease-out` only after interaction, add matching label-color transitions, and replace selected button background classes with `text-background`.

- [ ] **Step 4: Run test to verify it passes**

Run the command from Step 2. Expected: all ThemeButtons tests PASS.

### Task 2: Localized template-button geometry

**Files:**
- Modify: `src/frontend/src/components/core/flowBuilderWelcome/flow-builder-welcome.tsx`
- Test: `src/frontend/src/components/core/flowBuilderWelcome/__tests__/flow-builder-welcome.test.tsx`

**Interfaces:**
- Consumes: existing `onSelectTemplate` and `onBrowseMore` callbacks.
- Produces: three equal template buttons with `data-testid="flow-builder-welcome-*-label"` centered label spans.

- [ ] **Step 1: Write the failing test**

Assert that all three buttons share equal `h-16 w-[13.75rem] max-w-full` geometry and each label span has `min-w-0 whitespace-normal text-center leading-snug`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/core/flowBuilderWelcome/__tests__/flow-builder-welcome.test.tsx --runInBand`

Expected: FAIL because buttons use fixed `w-[11rem] whitespace-nowrap` and do not have label spans.

- [ ] **Step 3: Write minimal implementation**

Use a shared button geometry with a three-column grid, `h-16 w-[13.75rem] max-w-full`, non-shrinking icons, centered wrapping label spans, and an aria-hidden 1 rem balancing spacer. The resulting 220×64 px buttons fit the panel's 688 px content width with two 12 px gaps.

- [ ] **Step 4: Run test to verify it passes**

Run the command from Step 2. Expected: all FlowBuilderWelcome tests PASS.

### Task 3: Verification and local restart

**Files:**
- Verify: both source and test files from Tasks 1-2.

**Interfaces:**
- Consumes: completed UI fixes.
- Produces: a rebuilt local application at `http://localhost:7860`.

- [ ] **Step 1: Run focused Jest and Biome**

Run both Jest files together and run Biome on the four changed TypeScript files. Expected: exit 0.

- [ ] **Step 2: Build and restart**

Run `npm run build`, restart the existing `make run_cli open_browser=false` process, and verify `/` plus `/api/v1/config` return HTTP 200.

- [ ] **Step 3: Browser verification**

Check all three theme choices, the Russian Vector Store RAG button, and Browse More at the reported desktop viewport and a narrower viewport. Expected: one synchronized theme pill, no text overflow, equal button geometry, centered labels.
