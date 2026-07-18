# Product Design baseline audit

## Browser verification status

`BLOCKED_RESOURCE_GATED_LOCAL_SERVER`. Chrome was selected through the user
extension and the audit session was named. At `2026-07-18T13:50:28Z`, Chrome
attempted `http://127.0.0.1:7860/` and returned `net::ERR_CONNECTION_REFUSED`.
Because aggregate RSS was above the 14 GiB throttle, GC-16 prohibited starting
the backend/frontend server lane. The Product Design workflow stops when the
reference cannot be opened and captured, so no screenshot was fabricated and
static source is not mislabelled as visual or accessibility PASS.

## Grounded IA findings

1. The main Folder sidebar is the current project-like navigation, while the
   six-section Flow sidebar is an editor-local asset/history/trace rail. A
   future Project tree must not conflate these scopes.
2. Public Playground, private Flow session chat and agentic authoring assistant
   are three state/permission journeys. Deprecation metrics and UX labels must
   keep them distinct.
3. The dashboard account card, legacy header account menu and Flow MCP empty
   state all reach Settings. Source has an anti-duplication rule, but responsive
   single-trigger behavior still needs Chrome proof.
4. Invalid Folder/Flow states redirect to `/all`; browser verification must
   check stale-content flash, focus placement and whether the destination is
   intelligible.

## Existing design-system anchors

Use current semantic CSS tokens and Tailwind mapping from
`src/frontend/src/style/index.css` and `tailwind.config.mjs`. Existing Button
and Sidebar controls supply focus rings, active states and collapsed tooltips.
Do not invent a replacement palette, typography, icon language or spacing
system in Stage 01.

## Required browser queue

- Public/non-public/no-IO Playground states and redirect/focus behavior.
- Root, valid/invalid/deleted Folder and folder-context editor routes.
- Exactly one visible Settings trigger at desktop and <=1024px; keyboard,
  Escape and focus order across all editor sidebar sections.
- Editable/read-only/folder-context Flow, right-chat resize/fullscreen and
  agentic plan confirmation states.
- Light/dark, 200%/320% zoom, narrow reflow, semantic-token contrast and live
  region behavior during streaming.

Until current-run screenshots/DOM/network evidence exists, these checks are
`BLOCKED`, not failed and not passed.
