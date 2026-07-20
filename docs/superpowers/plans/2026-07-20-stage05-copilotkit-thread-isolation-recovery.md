# Stage 05 CopilotKit Thread Isolation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed two-chat CopilotKit identity blocker, finish the missing Stage-05 browser and Product Design evidence, correct the invalid runtime gate command, and obtain a fresh Stage-05 PASS without starting Stage 06.

**Architecture:** Keep one Board-level `CopilotKitProvider` and the one remote runtime agent `ketos-chat`. Each durable Chat Placement registers an official browser-local proxied agent under the deterministic `ketos-chat--CHAT_UUID` form with `runtimeAgentId: "ketos-chat"`; stock `CopilotChat` receives the local ID plus the durable Chat UUID as `threadId`. Ketos continues to own authorization, durable replay, `ChatRun`, and `MessageTable`; CopilotKit remains the stock UI and AG-UI transport client.

**Tech Stack:** React 19, TypeScript, Jest/Testing Library, CopilotKit React Core/Core 1.63.1, AG-UI, Playwright Chromium, FastAPI/Python, KFX/LangGraph, SQLite/PostgreSQL, Biome, Graphify navigation, Product Design audit, Chrome/Computer Use visual inspection.

## Global Constraints

- Execute only in `/Volumes/Projects/ketos-mvp-stage05-integration` on branch `codex/mvp-s05-integration`.
- Preserve `/Volumes/Projects/ketos_canvas_mod_main` and every unrelated dirty path. Do not merge, rebase, push, or delete a worktree as part of this plan.
- Stage-04 PASS base is `1ea57de7aa88dc8cff2cc2818af8e69d3420542c`. It must remain an ancestor of the recovery candidate.
- The blocked product candidate is `9ce671d064016148e739287630710002e55c95be`; preserve its working Stage-05 backend/runtime implementation and repair only the documented recovery scope.
- The accepted design is `docs/superpowers/specs/2026-07-20-stage05-copilotkit-thread-isolation-recovery-design.md`.
- Official CopilotKit source of truth is `registerProxiedAgent({ agentId, runtimeAgentId })`: the local `agentId` owns browser registry/subscription state, while `runtimeAgentId` owns the outbound runtime route. See the official [replacement PR](https://github.com/CopilotKit/CopilotKit/pull/4629) and the pinned installed declarations/runtime in `src/frontend/node_modules/@copilotkit/core/dist/index.d.mts` and `index.mjs`.
- `ketos-chat` remains the only remote runtime ID. A browser-local ID always has the `ketos-chat--CHAT_UUID` form and is never accepted as backend authority or sent as `threadId`.
- Keep one `CopilotKitProvider` per enabled Board. Do not add a provider per card, a second runtime agent, a wrapper chat body, custom composer, message/tool renderer, AG-UI parser, transport, model path, or durable store.
- Do not modify package manifests, lock files, vendored tarballs, generated artifacts, deployment files, `LICENSE`, or `NOTICE`.
- Product changes stay inside Stage 05. Stage 06 remains unstarted even if the final transition verdict becomes `GO`.
- Follow repository policy: only the main agent may use tools, inspect/edit files, browse, run tests, or verify. If execution uses subagents, they receive self-contained source slices and return code or unified diff text only; the main agent applies and verifies everything.
- Use Graphify query-only for navigation. The current root graph predates `ChatPlacement`, so direct source and executable tests remain authority; do not rebuild Graphify as a side effect.
- Use TDD order for every product change: write/strengthen a test, observe the intended failure, implement the smallest fix, rerun focused tests, review, fix findings, and rerun.
- Heavy gates are serial. Do not run migration dialect gates, frontend build/typecheck, or Playwright launches concurrently.

---

### Task 1: Freeze admission and reproduce the contract at unit level

**Files:**

- Create: `src/frontend/src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx`
- Create: `src/frontend/src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts`
- Modify: `src/frontend/src/components/core/board/placements/ChatPlacement.test.tsx`
- Read only: `src/frontend/node_modules/@copilotkit/core/dist/index.d.mts`
- Read only: `src/frontend/node_modules/@copilotkit/core/dist/index.mjs`
- Read only: `docs/dev/handoff/stage-05-durable-chat.md`

**Interfaces:**

- Consumes: installed `CopilotKitCore.registerProxiedAgent({ agentId: string, runtimeAgentId: string }): { agent; unregister: () => void }`, existing `ChatPlacementProps`, and the recorded two-chat failure.
- Produces: an executable pinned-core proxy contract, RED Jest contracts for `createThreadScopedAgentId(chatId)` and `useThreadScopedCopilotAgent(chatId)`, plus stock-placement expectations that Tasks 2 and 3 must satisfy.

- [ ] **Step 1: Prove the recovery checkout and prerequisite are exact**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
test "$(git branch --show-current)" = "codex/mvp-s05-integration"
git merge-base --is-ancestor 1ea57de7aa88dc8cff2cc2818af8e69d3420542c HEAD
test -z "$(git status --porcelain)"
git log -3 --oneline
```

Expected: all commands exit `0`; the design/blocked-closure commits are visible and the worktree is clean. Stop with the exact dirty paths or ancestry error if any assertion fails.

- [ ] **Step 2: Prove the admitted API exists in both types and runtime**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
rg -n "registerProxiedAgent|runtimeAgentId" \
  src/frontend/node_modules/@copilotkit/core/dist/index.d.mts \
  src/frontend/node_modules/@copilotkit/core/dist/index.mjs
```

Expected: declarations include `CopilotKitCoreRegisterProxiedAgentParams` and the runtime includes collision rejection plus an `unregister` closure. No dependency installation or lock rewrite is allowed.

- [ ] **Step 3: Lock the pinned dependency behavior in an executable contract**

Create `copilotkit-proxy-contract.test.ts`:

```ts
import { CopilotKitCore, ProxiedCopilotRuntimeAgent } from "@copilotkit/core";

const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";

describe("pinned CopilotKit proxied-agent contract", () => {
  it("shows why one registry id cannot own two thread ids", () => {
    const core = new CopilotKitCore({ deferInitialConnection: true });
    const registered = core.registerProxiedAgent({
      agentId: "ketos-chat",
      runtimeAgentId: "ketos-chat",
    });
    const firstConsumer = core.getAgent("ketos-chat");
    const secondConsumer = core.getAgent("ketos-chat");

    expect(firstConsumer).toBe(secondConsumer);
    if (!firstConsumer || !secondConsumer) {
      throw new Error("The registered dependency-contract agent is required");
    }
    firstConsumer.threadId = CHAT_ONE;
    secondConsumer.threadId = CHAT_TWO;
    expect(firstConsumer.threadId).toBe(CHAT_TWO);
    registered.unregister();
  });

  it("keeps two local proxies distinct while routing both to ketos-chat", () => {
    const core = new CopilotKitCore({ deferInitialConnection: true });
    const first = core.registerProxiedAgent({
      agentId: `ketos-chat--${CHAT_ONE}`,
      runtimeAgentId: "ketos-chat",
    });
    const second = core.registerProxiedAgent({
      agentId: `ketos-chat--${CHAT_TWO}`,
      runtimeAgentId: "ketos-chat",
    });

    expect(first.agent).not.toBe(second.agent);
    expect(first.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(second.agent).toBeInstanceOf(ProxiedCopilotRuntimeAgent);
    expect(first.agent.runtimeAgentId).toBe("ketos-chat");
    expect(second.agent.runtimeAgentId).toBe("ketos-chat");

    first.unregister();
    second.unregister();
    expect(core.getAgent(`ketos-chat--${CHAT_ONE}`)).toBeUndefined();
    expect(core.getAgent(`ketos-chat--${CHAT_TWO}`)).toBeUndefined();
  });
});
```

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
npm test -- --runInBand \
  src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts
```

Expected: `2 passed`; the first case proves the old shared-object defect and the second proves the admitted official replacement on the pinned artifact.

- [ ] **Step 4: Write the hook lifecycle tests before the hook exists**

Create `use-thread-scoped-copilot-agent.test.tsx` with these exact contract cases:

1. two valid Chat UUIDs register two different local IDs against the same `ketos-chat` runtime ID;
2. React StrictMode performs register/unregister/register and final unmount unregisters the active proxy;
3. changing `chatId` fails closed as `registering`, unregisters the old proxy, and registers the new proxy;
4. a registration collision renders `error`; invoking `retry` creates one new registration generation;
5. a malformed Chat ID renders `error` without calling `registerProxiedAgent`;
6. an ordinary rerender with the same Chat ID neither changes the local ID nor registers again;
7. replacing the provider/core instance fails closed, unregisters the old proxy, and registers against the new owner;
8. the local-ID builder is deterministic and never appends randomness.

Use valid deterministic UUIDs:

```ts
const CHAT_ONE = "11111111-1111-4111-8111-111111111111";
const CHAT_TWO = "22222222-2222-4222-8222-222222222222";
```

Mock only `useCopilotKit`; do not mock React effects:

```ts
const mockRegisterProxiedAgent = jest.fn();
let mockCopilotkit = {
  registerProxiedAgent: mockRegisterProxiedAgent,
};

jest.mock("@copilotkit/react-core/v2", () => ({
  useCopilotKit: () => ({
    copilotkit: mockCopilotkit,
  }),
}));

function BindingProbe({ chatId }: { chatId: string }) {
  const binding = useThreadScopedCopilotAgent(chatId);
  return (
    <section
      data-testid="binding"
      data-agent-id={binding.localAgentId}
      data-status={binding.status}
    >
      {binding.error?.message ?? "no-error"}
      <button type="button" onClick={binding.retry}>
        retry
      </button>
    </section>
  );
}

beforeEach(() => {
  mockRegisterProxiedAgent.mockReset();
  mockCopilotkit = {
    registerProxiedAgent: mockRegisterProxiedAgent,
  };
});
```

The StrictMode assertion must prove both handles are cleaned:

```ts
const firstUnregister = jest.fn();
const secondUnregister = jest.fn();
mockRegisterProxiedAgent
  .mockReturnValueOnce({ agent: {}, unregister: firstUnregister })
  .mockReturnValueOnce({ agent: {}, unregister: secondUnregister });

const view = render(
  <StrictMode>
    <BindingProbe chatId={CHAT_ONE} />
  </StrictMode>,
);

expect(mockRegisterProxiedAgent).toHaveBeenCalledTimes(2);
expect(firstUnregister).toHaveBeenCalledTimes(1);
view.unmount();
expect(secondUnregister).toHaveBeenCalledTimes(1);
```

- [ ] **Step 5: Strengthen `ChatPlacement` tests before changing production code**

Replace non-UUID fixtures with the two deterministic UUIDs above. Mock the future hook at `../../chats/use-thread-scoped-copilot-agent` and make the default return value `ready` with local ID `ketos-chat--${chatId}`.

Use this exact mock seam:

```ts
const mockUseThreadScopedCopilotAgent = jest.fn((chatId: string) => ({
  status: "ready" as const,
  localAgentId: `ketos-chat--${chatId}`,
  error: null,
  retry: jest.fn(),
}));

jest.mock("../../chats/use-thread-scoped-copilot-agent", () => ({
  useThreadScopedCopilotAgent: (chatId: string) =>
    mockUseThreadScopedCopilotAgent(chatId),
}));
```

Change the stock component expectation to:

```ts
expect(chats).toEqual([
  expect.objectContaining({
    agentId: `ketos-chat--${CHAT_ONE}`,
    threadId: CHAT_ONE,
  }),
  expect.objectContaining({
    agentId: `ketos-chat--${CHAT_TWO}`,
    threadId: CHAT_TWO,
  }),
]);
```

Add focused cases that assert:

- `registering` renders `chat.states.connecting` with `role="status"` and does not mount `CopilotChat`;
- `error` renders `chat.states.agentError` with `role="alert"`, exposes `chat.actions.retry`, calls the returned `retry`, and does not mount `CopilotChat`;
- `ready` is the only state that mounts stock `CopilotChat`;
- the existing CardFrame lifecycle and custom-stack source guard remain unchanged.

- [ ] **Step 6: Run the new contract tests and observe RED**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
npm test -- --runInBand \
  src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts \
  src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx \
  src/components/core/board/placements/ChatPlacement.test.tsx
```

Expected: non-zero exit because the hook module does not exist and `ChatPlacement` still passes `agentId="ketos-chat"`. A failure caused only by a test typo or invalid fixture is not the intended RED and must be corrected before proceeding.

Do not commit a knowingly broken tree.

---

### Task 2: Implement the thread-scoped proxy lifecycle

**Files:**

- Create: `src/frontend/src/components/core/chats/use-thread-scoped-copilot-agent.ts`
- Test: `src/frontend/src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx`

**Interfaces:**

- Consumes: Task-1 lifecycle tests and `useCopilotKit(): { copilotkit: CopilotKitCoreReact }`.
- Produces: `CHAT_RUNTIME_AGENT_ID`, `createThreadScopedAgentId(chatId: string): string`, `ThreadScopedAgentBinding`, and `useThreadScopedCopilotAgent(chatId: string): ThreadScopedAgentBinding`.

- [ ] **Step 1: Implement the deterministic, validated local identity**

Use the already-installed `uuid` dependency; do not change package files:

```ts
import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useState } from "react";
import { validate as isUuid } from "uuid";

export const CHAT_RUNTIME_AGENT_ID = "ketos-chat";

export type ThreadScopedAgentBinding = {
  localAgentId: string;
  retry: () => void;
} & (
  | { status: "registering"; error: null }
  | { status: "ready"; error: null }
  | { status: "error"; error: Error }
);

type RegistrationState = {
  key: string;
  owner: object | null;
  status: "registering" | "ready" | "error";
  error: Error | null;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createThreadScopedAgentId(chatId: string): string {
  if (!isUuid(chatId)) {
    throw new Error("A durable Chat UUID is required for CopilotKit binding");
  }
  return `${CHAT_RUNTIME_AGENT_ID}--${chatId}`;
}
```

- [ ] **Step 2: Implement effect-only registration and fail-closed state**

The hook must never register during render and must not expose an old ready state after `chatId` or retry changes:

```ts
export function useThreadScopedCopilotAgent(
  chatId: string,
): ThreadScopedAgentBinding {
  const { copilotkit } = useCopilotKit();
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1);
  }, []);

  const requested = useMemo(() => {
    const fallbackLocalAgentId = `${CHAT_RUNTIME_AGENT_ID}--${chatId}`;
    try {
      const localAgentId = createThreadScopedAgentId(chatId);
      return {
        key: `${localAgentId}:${retryGeneration}`,
        localAgentId,
        validationError: null,
      };
    } catch (error) {
      return {
        key: `invalid:${chatId}:${retryGeneration}`,
        localAgentId: fallbackLocalAgentId,
        validationError: asError(error),
      };
    }
  }, [chatId, retryGeneration]);

  const [registration, setRegistration] = useState<RegistrationState>({
    key: "",
    owner: null,
    status: "registering",
    error: null,
  });

  useEffect(() => {
    if (requested.validationError) {
      setRegistration({
        key: requested.key,
        owner: copilotkit,
        status: "error",
        error: requested.validationError,
      });
      return;
    }

    setRegistration({
      key: requested.key,
      owner: copilotkit,
      status: "registering",
      error: null,
    });

    try {
      const { unregister } = copilotkit.registerProxiedAgent({
        agentId: requested.localAgentId,
        runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
      });
      setRegistration({
        key: requested.key,
        owner: copilotkit,
        status: "ready",
        error: null,
      });
      return unregister;
    } catch (error) {
      setRegistration({
        key: requested.key,
        owner: copilotkit,
        status: "error",
        error: asError(error),
      });
      return;
    }
  }, [copilotkit, requested]);

  const visible: RegistrationState =
    registration.key === requested.key && registration.owner === copilotkit
      ? registration
      : requested.validationError
        ? {
            key: requested.key,
            owner: copilotkit,
            status: "error",
            error: requested.validationError,
          }
        : {
            key: requested.key,
            owner: copilotkit,
            status: "registering",
            error: null,
          };

  if (visible.status === "error") {
    return {
      status: "error",
      localAgentId: requested.localAgentId,
      error: visible.error ?? new Error("CopilotKit registration failed"),
      retry,
    };
  }

  return {
    status: visible.status,
    localAgentId: requested.localAgentId,
    error: null,
    retry,
  };
}
```

During implementation, if Biome reports that the memoized object causes an effect-dependency issue, destructure the stable primitive fields before the effect; do not suppress the rule and do not move registration into render.

- [ ] **Step 3: Run the hook tests GREEN**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
npm test -- --runInBand \
  src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts \
  src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx
npx biome check \
  src/components/core/chats/use-thread-scoped-copilot-agent.ts \
  src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts \
  src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx
```

Expected: all hook cases pass; Biome exits `0`.

- [ ] **Step 4: Review lifecycle/security invariants before commit**

Verify in source and tests:

- no call to `registerProxiedAgent` occurs outside `useEffect`;
- every successful registration returns its exact `unregister` handle as cleanup;
- duplicate local IDs fail closed instead of reusing an unknown agent;
- malformed IDs never reach registration;
- only `CHAT_RUNTIME_AGENT_ID` controls `runtimeAgentId`;
- no random, timestamp, index, Placement ID, or Board ID enters the local ID.

- [ ] **Step 5: Commit the green hook slice**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add \
  src/frontend/src/components/core/chats/use-thread-scoped-copilot-agent.ts \
  src/frontend/src/components/core/chats/__tests__/copilotkit-proxy-contract.test.ts \
  src/frontend/src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx
git diff --cached --check
git commit -m "feat(chat): add thread scoped CopilotKit proxy binding"
```

Expected: one focused commit; the still-uncommitted `ChatPlacement.test.tsx` RED changes remain visible and owned by Task 3.

---

### Task 3: Bind stock `CopilotChat` to the local proxy and expose shell states

**Files:**

- Modify: `src/frontend/src/components/core/board/placements/ChatPlacement.tsx`
- Modify: `src/frontend/src/components/core/board/placements/ChatPlacement.test.tsx`
- Modify: `src/frontend/src/locales/en.json`
- Modify: `src/frontend/src/locales/ru.json`
- Modify: `scripts/mvp/test_chat_stack_boundaries.py`

**Interfaces:**

- Consumes: Task-2 `useThreadScopedCopilotAgent` and existing `ChatPlacementProps`/`BoardCardFrame` callbacks.
- Produces: stock `CopilotChat` mounted only for a ready binding, localized registering/error/retry shell states, unchanged CardFrame lifecycle behavior, and an executable source guard for the official proxy architecture.

- [ ] **Step 1: Add a failing executable guard for the chosen architecture**

Add these path constants to `scripts/mvp/test_chat_stack_boundaries.py`:

```py
CHAT_PLACEMENT = (
    WORKSPACE / "src/frontend/src/components/core/board/placements/ChatPlacement.tsx"
)
CHAT_PROVIDER = (
    WORKSPACE / "src/frontend/src/components/core/chats/CopilotKitBoardProvider.tsx"
)
THREAD_SCOPED_AGENT_HOOK = (
    WORKSPACE
    / "src/frontend/src/components/core/chats/use-thread-scoped-copilot-agent.ts"
)
```

Add this exact test:

```py
def test_stage05_frontend_uses_one_provider_and_official_thread_proxies() -> None:
    placement = CHAT_PLACEMENT.read_text(encoding="utf-8")
    provider = CHAT_PROVIDER.read_text(encoding="utf-8")
    hook = THREAD_SCOPED_AGENT_HOOK.read_text(encoding="utf-8")

    assert provider.count("<CopilotKitProvider") == 1
    assert "CopilotKitProvider" not in placement
    assert "CopilotKitProvider" not in hook
    assert "registerProxiedAgent" in hook
    assert 'CHAT_RUNTIME_AGENT_ID = "ketos-chat"' in hook
    assert "runtimeAgentId: CHAT_RUNTIME_AGENT_ID" in hook
    assert "useThreadScopedCopilotAgent(props.chat.id)" in placement
    assert "agentId={binding.localAgentId}" in placement
    assert "threadId={props.chat.id}" in placement
```

Run before modifying `ChatPlacement.tsx`:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
uv run pytest \
  scripts/mvp/test_chat_stack_boundaries.py::test_stage05_frontend_uses_one_provider_and_official_thread_proxies \
  -q
```

Expected: FAIL because `ChatPlacement.tsx` still uses the shared literal `agentId="ketos-chat"`.

- [ ] **Step 2: Add exact localized placement-binding states**

Add these flat locale keys next to the existing `chat.states.*` entries:

```json
"chat.states.connecting": "Connecting chat…",
"chat.states.agentError": "Chat could not be connected",
```

and in Russian:

```json
"chat.states.connecting": "Подключаем чат…",
"chat.states.agentError": "Не удалось подключить чат",
```

Reuse `chat.actions.retry`; do not add raw English or Russian strings to the component.

- [ ] **Step 3: Integrate the hook above the CardFrame body**

Import `Button` from `@/components/ui/button` and `useThreadScopedCopilotAgent` from `../../chats/use-thread-scoped-copilot-agent`. Call the hook unconditionally at the start of `ChatPlacement` so its lifetime follows the Placement, including collapsed body unmounts.

Replace only the current body with:

```tsx
<div className="h-full min-h-0 bg-background text-foreground">
  {binding.status === "registering" ? (
    <div className="flex h-full items-center justify-center p-4">
      <p role="status" className="text-sm text-muted-foreground">
        {t("chat.states.connecting")}
      </p>
    </div>
  ) : null}
  {binding.status === "error" ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <p role="alert" className="text-sm text-destructive">
        {t("chat.states.agentError")}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={binding.retry}>
        {t("chat.actions.retry")}
      </Button>
    </div>
  ) : null}
  {binding.status === "ready" ? (
    <CopilotChat
      key={props.chat.id}
      agentId={binding.localAgentId}
      threadId={props.chat.id}
    />
  ) : null}
</div>
```

Do not add CopilotKit slots or pass message/state arrays.

- [ ] **Step 4: Run focused component, lifecycle, guard, and locale tests**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
npm test -- --runInBand \
  src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx \
  src/components/core/board/placements/ChatPlacement.test.tsx \
  src/components/core/chats/__tests__/CopilotKitBoardProvider.test.tsx \
  src/components/core/chats/__tests__/legacy-isolation.test.ts
npm run i18n:check
npm run type-check:production
npx biome check \
  src/components/core/chats/use-thread-scoped-copilot-agent.ts \
  src/components/core/chats/__tests__/use-thread-scoped-copilot-agent.test.tsx \
  src/components/core/board/placements/ChatPlacement.tsx \
  src/components/core/board/placements/ChatPlacement.test.tsx \
  src/locales/en.json \
  src/locales/ru.json
```

Expected: all commands exit `0`; stock `CopilotChat` mounts only for `ready`; provider and legacy isolation remain green.

- [ ] **Step 5: Audit the component boundary**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
uv run pytest scripts/mvp/test_chat_stack_boundaries.py -q
rg -n "CopilotKitProvider|renderTool|renderActivity|messages=|isRunning=|#[0-9a-fA-F]{3,8}" \
  src/frontend/src/components/core/board/placements/ChatPlacement.tsx \
  src/frontend/src/components/core/chats/use-thread-scoped-copilot-agent.ts || true
```

Expected: boundary test passes. The source search may find type/property text only where expected; it must not reveal a second provider, custom renderer, controlled message state, or raw color.

- [ ] **Step 6: Commit the stock-placement integration**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add \
  src/frontend/src/components/core/board/placements/ChatPlacement.tsx \
  src/frontend/src/components/core/board/placements/ChatPlacement.test.tsx \
  src/frontend/src/locales/en.json \
  src/frontend/src/locales/ru.json \
  scripts/mvp/test_chat_stack_boundaries.py
git diff --cached --check
git commit -m "fix(chat): isolate stock CopilotKit placement identities"
```

Expected: focused commit, no package/lock or provider file change.

---

### Task 4: Upgrade the real browser regression to prove both directions of isolation

**Files:**

- Modify: `src/frontend/tests/core/integrations/board-copilot-chat.spec.ts`

**Interfaces:**

- Consumes: Task-3 stock placement, fixed remote route `/api/copilotkit/agent/ketos-chat/run`, durable Chat UUIDs, and the deterministic local OpenAI-compatible provider.
- Produces: a two-prompt/two-answer browser contract, isolated request/UI/DB assertions, persisted `stage05-ids.json`, and configurable `STAGE05_EVIDENCE_ROOT` for clean verification reruns.

- [ ] **Step 1: Make screenshot output explicit and keep verification reruns clean**

Replace the fixed evidence root with:

```ts
const repositoryRoot = path.resolve(process.cwd(), "../..");
const evidenceRoot =
  process.env.STAGE05_EVIDENCE_ROOT ??
  path.join(repositoryRoot, "docs/evidence/stage-05/product-design");
```

Evidence-capture launches intentionally omit `STAGE05_EVIDENCE_ROOT` and write the five tracked PNGs. Every other browser gate sets it to a directory under its external `KETOS_MVP_RUN_DIR`, preventing final verification from dirtying committed evidence.

- [ ] **Step 2: Give each durable Chat its own prompt and answer**

Replace the scalar `prompt`/`answer` fields in `Stage05Ids` with tuples:

```ts
type Stage05Ids = {
  projectId: string;
  boardId: string;
  chatIds: [string, string];
  titles: [string, string];
  prompts: [string, string];
  answers: [string, string];
};

const prompts: [string, string] = [
  "Use the current date tool for UTC, then answer for stage05-release.",
  "Use the current date tool for UTC, then answer for stage05-operations.",
];
const answers: [string, string] = [
  "Release evidence is durable after the read-only UTC date check.",
  "Operations notes are durable after the read-only UTC date check.",
];
```

Construct the persisted IDs object with the tuple fields:

```ts
const ids: Stage05Ids = {
  projectId: project.id,
  boardId: board.id,
  chatIds: ["", ""],
  titles: ["Release evidence", "Operations notes"],
  prompts,
  answers,
};
```

- [ ] **Step 3: Make the deterministic provider answer from the user marker**

Extend only the local test provider payload type and content normalization:

```ts
type ProviderMessage = {
  role?: string;
  content?: string | Array<{ text?: string }>;
};

function providerText(content: ProviderMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => item.text ?? "").join(" ");
}
```

After detecting a tool result, select the answer from all user messages:

```ts
const userText = (payload.messages ?? [])
  .filter((message) => message.role === "user")
  .map((message) => providerText(message.content))
  .join(" ");
const answerIndex = userText.includes("stage05-operations") ? 1 : 0;
const selectedAnswer = answers[answerIndex];
```

Add a deterministic answer-release queue at module scope:

```ts
const pendingProviderAnswers: Array<() => void> = [];
```

Instead of immediately emitting the final answer, enqueue the exact response closure:

```ts
pendingProviderAnswers.push(() => {
  sendSse(response, [
    completionChunk(
      `chatcmpl-stage05-answer-${answerIndex}`,
      { role: "assistant", content: selectedAnswer },
      null,
    ),
    completionChunk(`chatcmpl-stage05-answer-${answerIndex}`, {}, "stop"),
  ]);
});
```

The test releases each answer only after checking the stock running/disabled state. Keep the KFX `get_current_date` tool call and standard SSE/AG-UI path unchanged.

- [ ] **Step 4: Send through both stock chat surfaces and assert every identity layer**

For index `0` and `1`, perform a separate send and assert:

- the browser request URL remains `/api/copilotkit/agent/ketos-chat/run`;
- the request `threadId` equals that Chat's durable UUID;
- the response contains the tool lifecycle and that Chat's answer;
- the answer appears in its own CardFrame and not the sibling CardFrame;
- the request state contains only the allowed `boardId`/`projectId` keys;
- exactly two browser run requests and four provider calls occurred after both tool cycles.

Use this loop shape:

```ts
const cards = [firstCard, secondCard] as const;
const runBodies: Array<{
  threadId: string;
  state?: Record<string, unknown>;
}> = [];

for (const index of [0, 1] as const) {
  const requestPromise = page.waitForRequest(isChatRun);
  const responsePromise = page.waitForResponse((response) =>
    isChatRun(response.request()),
  );
  await cards[index]
    .getByTestId("copilot-chat-textarea")
    .fill(ids.prompts[index]);
  const sendButton = cards[index].getByTestId("copilot-send-button");
  await sendButton.click();
  const request = await requestPromise;
  expect(new URL(request.url()).pathname).toBe(
    "/api/copilotkit/agent/ketos-chat/run",
  );
  const body = request.postDataJSON() as {
    threadId: string;
    state?: Record<string, unknown>;
  };
  runBodies.push(body);
  expect(body.threadId).toBe(ids.chatIds[index]);
  await expect.poll(() => pendingProviderAnswers.length).toBe(1);
  await expect(sendButton).toBeDisabled();
  expect(runRequests).toHaveLength(index + 1);
  pendingProviderAnswers.shift()?.();
  const response = await responsePromise;
  const responseText = await response.text();
  expect(response.status()).toBe(200);
  expect(responseText).toContain("get_current_date");
  expect(responseText).toContain(ids.answers[index]);
  await expect(
    cards[index].getByText(ids.answers[index], { exact: true }),
  ).toBeVisible();
  await expect(
    cards[index === 0 ? 1 : 0].getByText(ids.answers[index], { exact: true }),
  ).toHaveCount(0);
}

expect(runRequests).toHaveLength(2);
expect(pendingProviderAnswers).toHaveLength(0);
expect(providerCalls).toBe(4);
```

Replay `runBodies[0]` directly against the fixed remote route and assert `replayed: true` without increasing `providerCalls`.

- [ ] **Step 5: Assert both durable database histories**

For each Chat, require one `ChatRun`, the exact prompt/answer pair, and sequences `[1, 2]`:

```ts
for (const index of [0, 1] as const) {
  const durable = readDurableRows(ids.chatIds[index]);
  expect(durable.runs.count).toBe(1);
  expect(durable.messages.map((row) => row.text)).toEqual([
    ids.prompts[index],
    ids.answers[index],
  ]);
  expect(durable.messages.map((row) => row.chat_sequence)).toEqual([1, 2]);
}
```

Keep the close/re-place flow on the first Chat. In the restore-only test, assert both answers are visible under their own named regions.

Before running Playwright, verify no scalar field reference remains:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
if rg -n 'ids\.(prompt|answer)\b' \
  src/frontend/tests/core/integrations/board-copilot-chat.spec.ts; then
  exit 1
fi
```

- [ ] **Step 6: Run the real API/DB browser test on a fresh external run root**

Run serially:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
export S05_RECOVERY_RUN_ROOT="$(mktemp -d /Volumes/Projects/.ketos-stage05-recovery.XXXXXX)"
cd src/frontend
OPENAI_API_KEY=stage05-local \
OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
STAGE05_OPENAI_PORT=18765 \
KETOS_MVP_RUN_DIR="$S05_RECOVERY_RUN_ROOT" \
STAGE05_EVIDENCE_ROOT="$S05_RECOVERY_RUN_ROOT/screenshots" \
KETOS_FEATURE_MVP_CHAT=true \
STAGE05_RESTORE_ONLY=false \
npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
  --config=playwright.mvp.config.ts \
  --project=chromium \
  --grep "real API and DB preserve two chats"
```

Expected: exit `0`; both remote request URLs use `ketos-chat`, request bodies contain their own Chat UUIDs, browser answers remain isolated, both DB histories pass, and screenshots `01` through `05` are produced.

- [ ] **Step 7: Commit the browser regression, not generated evidence yet**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add src/frontend/tests/core/integrations/board-copilot-chat.spec.ts
git diff --cached --check
git commit -m "test(chat): prove two durable CopilotKit threads"
```

Leave the current-run screenshot changes for Task 5.

---

### Task 5: Complete flag, restore, focus, reconnect, and Product Design evidence

**Files:**

- Modify: `docs/evidence/stage-05/product-design/01-empty.png`
- Modify: `docs/evidence/stage-05/product-design/02-search-no-results.png`
- Modify: `docs/evidence/stage-05/product-design/03-two-chats.png`
- Create: `docs/evidence/stage-05/product-design/04-error-reconnect.png`
- Create: `docs/evidence/stage-05/product-design/05-close-replace-focus.png`
- Modify: `docs/evidence/stage-05/product-design/audit.md`

**Interfaces:**

- Consumes: Task-4 controlled Playwright story and `STAGE05_EVIDENCE_ROOT`.
- Produces: five current-run PNGs plus a source- and interaction-backed Product Design verdict.

- [ ] **Step 1: Rerun the main launch from a fresh durable root**

Do not reuse the Task-4 root for final evidence. Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
export S05_FINAL_RUN_ROOT="$(mktemp -d /Volumes/Projects/.ketos-stage05-final.XXXXXX)"
cd src/frontend
OPENAI_API_KEY=stage05-local \
OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
STAGE05_OPENAI_PORT=18765 \
KETOS_MVP_RUN_DIR="$S05_FINAL_RUN_ROOT" \
STAGE05_EVIDENCE_ROOT=/Volumes/Projects/ketos-mvp-stage05-integration/docs/evidence/stage-05/product-design \
KETOS_FEATURE_MVP_CHAT=true \
STAGE05_RESTORE_ONLY=false \
npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
  --config=playwright.mvp.config.ts \
  --project=chromium \
  --grep "real API and DB preserve two chats"
```

Expected: exit `0`; `stage05-ids.json` exists under the external run root and screenshots `01`–`05` exist in the tracked evidence directory.

- [ ] **Step 2: Prove default-off hides only UI while data survives**

Run against the same root:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
OPENAI_API_KEY=stage05-local \
OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
STAGE05_OPENAI_PORT=18765 \
KETOS_MVP_RUN_DIR="$S05_FINAL_RUN_ROOT" \
KETOS_FEATURE_MVP_CHAT=false \
STAGE05_RESTORE_ONLY=false \
npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
  --config=playwright.mvp.config.ts \
  --project=chromium \
  --grep "mvp_chat off hides UI"
```

Expected: exit `0`; no Chat UI is rendered, while both owner API reads return the same durable IDs.

- [ ] **Step 3: Prove re-enable restores both independent transcripts**

Run against the same root:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/frontend
OPENAI_API_KEY=stage05-local \
OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
STAGE05_OPENAI_PORT=18765 \
KETOS_MVP_RUN_DIR="$S05_FINAL_RUN_ROOT" \
KETOS_FEATURE_MVP_CHAT=true \
STAGE05_RESTORE_ONLY=true \
npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
  --config=playwright.mvp.config.ts \
  --project=chromium \
  --grep "mvp_chat re-enable restores"
```

Expected: exit `0`; each named Chat region contains its own answer and excludes the sibling answer.

- [ ] **Step 4: Perform the Product Design/Chrome/Computer visual audit**

Inspect all five PNGs at their original resolution. Use the Product Design audit skill to check hierarchy, stock-chat consistency, semantic state clarity, focus affordance, clipping/overlap, and distinguishability of the two chats. Use Chrome to open the local PNGs and Computer Use to inspect them when their controllers are exposed; Playwright assertions remain authoritative. If either controller is unavailable, record that exact capability limit and use local image inspection without claiming the unavailable tool ran.

The audit must explicitly cover:

- `01-empty.png`: list hierarchy, search/create actions, empty copy;
- `02-search-no-results.png`: query, clear control, no-results feedback;
- `03-two-chats.png`: two titled stock surfaces with no card/composer collision;
- `04-error-reconnect.png`: error and reconnect feedback readable without layout loss;
- `05-close-replace-focus.png`: replaced first Chat, restored transcript, visible focused control, second Chat still distinct;
- no claim of full WCAG conformance from screenshots alone.

- [ ] **Step 5: Rewrite the audit from the current evidence**

Update `audit.md` to:

- identify the tested candidate commit;
- mark the prior shared-agent finding as resolved through official local proxy registration;
- list all five current-run screenshots;
- state the two-chat request/body/UI/DB evidence;
- record Product Design, Chrome, Computer Use, and local-image tool availability truthfully;
- leave no historical expected/received UUIDs as active blockers;
- give `PASS` only if every screenshot and browser assertion passed.

- [ ] **Step 6: Commit current-run visual evidence**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add docs/evidence/stage-05/product-design
git diff --cached --check
git commit -m "test(chat): capture stage05 recovery evidence"
```

Expected: all five screenshots plus the updated audit are committed; no Playwright `test-results` directory is staged.

---

### Task 6: Correct the invalid Vitest command in the Stage-05 gate

**Files:**

- Modify: `19_KETOS_STAGE_05_DURABLE_CHAT_COPILOTKIT_AG_UI.md`
- Read only: `src/copilot-runtime/package.json`

**Interfaces:**

- Consumes: runtime script `test: vitest run` and the proven invalid `--runInBand` invocation.
- Produces: a factually executable S05-A06/§10.2 runtime command without relaxing test, typecheck, or build coverage.

- [ ] **Step 1: Reconfirm the old command failure and the supported replacement**

Run the historical command once:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/copilot-runtime
npm test -- --runInBand src/__tests__/ketos-chat.test.ts
```

Expected: non-zero with Vitest rejecting `--runInBand`.

Then run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration/src/copilot-runtime
npm test -- src/__tests__/ketos-chat.test.ts
npm run typecheck
npm run build
```

Expected: all three commands exit `0`.

- [ ] **Step 2: Repair both runtime command occurrences without changing criteria**

In S05-A06 and §10.2 replace:

```bash
(cd src/copilot-runtime && npm test -- --runInBand src/__tests__/ketos-chat.test.ts)
```

with:

```bash
(cd src/copilot-runtime && npm test -- src/__tests__/ketos-chat.test.ts)
```

This is a runner-syntax correction only. Do not relax runtime tests, typecheck, or build.

- [ ] **Step 3: Verify no invalid runtime invocation remains**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
if rg -n "src/copilot-runtime.*runInBand" 19_KETOS_STAGE_05_DURABLE_CHAT_COPILOTKIT_AG_UI.md; then
  exit 1
fi
git diff --check
```

Expected: exit `0` and no match.

- [ ] **Step 4: Commit the factual gate correction**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add 19_KETOS_STAGE_05_DURABLE_CHAT_COPILOTKIT_AG_UI.md
git diff --cached --check
git commit -m "docs(chat): correct stage05 runtime gate"
```

---

### Task 7: Run the full audit/fix/reverify loop on one product candidate

**Files:**

- Create: `scripts/mvp/run_stage05_recovery_gate.sh`
- Verify: all Stage-05 changed source/tests/evidence since `1ea57de7aa88dc8cff2cc2818af8e69d3420542c`
- External evidence only: one `/Volumes/Projects/.ketos-stage05-gate.*` directory per candidate

**Interfaces:**

- Consumes: Tasks 2–6 implementation/evidence, `MVP_POSTGRES_URI`, the three Playwright launch modes, and Stage-04 base SHA `1ea57de7aa88dc8cff2cc2818af8e69d3420542c`.
- Produces: `scripts/mvp/run_stage05_recovery_gate.sh RUN_ROOT`, a repeatable serial acceptance command that writes screenshots/test state only below `RUN_ROOT` and exits non-zero on any Stage-05 gate, prohibited path, or dirty worktree.

- [ ] **Step 1: Write the repeatable serial recovery gate**

Create `scripts/mvp/run_stage05_recovery_gate.sh` with this complete implementation:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /Volumes/Projects/.ketos-stage05-gate.RUN_ID" >&2
  exit 64
fi

repository_root="/Volumes/Projects/ketos-mvp-stage05-integration"
run_root="$1"
stage_base_sha="1ea57de7aa88dc8cff2cc2818af8e69d3420542c"

case "$run_root" in
  /Volumes/Projects/.ketos-stage05-*) ;;
  *)
    echo "run root must be a Stage-05 directory below /Volumes/Projects" >&2
    exit 64
    ;;
esac

if [[ -z "${MVP_POSTGRES_URI:-}" ]]; then
  echo "BLOCKED: MVP_POSTGRES_URI is required for Stage-05 PostgreSQL parity" >&2
  exit 2
fi

mkdir -p "$run_root/screenshots"
cd "$repository_root"
test -z "$(git status --porcelain)"
git merge-base --is-ancestor "$stage_base_sha" HEAD

uv run pytest \
  src/backend/tests/unit/services/chat_threads \
  src/backend/tests/unit/services/board/test_placement_service.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_router.py \
  src/backend/tests/unit/api/v1/test_chat_threads.py -q

MIGRATION_VALIDATION_CI=1 uv run pytest \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_migration_sqlite \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_model_parity_sqlite \
  src/backend/tests/unit/alembic/test_migration_execution.py -q

MIGRATION_VALIDATION_CI=1 \
KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI" \
uv run pytest \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_migration_postgres \
  src/backend/tests/unit/alembic/test_mvp_chat_migration.py::test_s05_chat_model_parity_postgres \
  src/backend/tests/unit/alembic/test_migration_execution.py -q

uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py \
  scripts/mvp/test_chat_stack_boundaries.py -q

(cd src/copilot-runtime && npm test -- src/__tests__/ketos-chat.test.ts)
(cd src/copilot-runtime && npm run typecheck)
(cd src/copilot-runtime && npm run build)

(cd src/frontend && npm test -- --runInBand \
  src/components/core/board/placements/ChatPlacement.test.tsx \
  src/components/core/chats \
  src/controllers/API/queries/agentic/__tests__/use-post-assist-stream.test.ts \
  src/pages/FlowPage/components/flowBuildingComponent/__tests__/index.test.tsx \
  src/pages/FlowPage/components/PageComponent/__tests__/read-only-contract.test.ts \
  src/CustomNodes/NoteNode/__tests__/note-node-utils.test.ts)
(cd src/frontend && npm run i18n:check)
(cd src/frontend && npm run type-check:production)
(cd src/frontend && npm run build)

run_browser_gate() {
  local feature_flag="$1"
  local restore_only="$2"
  local title_pattern="$3"

  (
    cd src/frontend
    OPENAI_API_KEY=stage05-local \
    OPENAI_API_BASE=http://127.0.0.1:18765/v1 \
    STAGE05_OPENAI_PORT=18765 \
    KETOS_MVP_RUN_DIR="$run_root" \
    STAGE05_EVIDENCE_ROOT="$run_root/screenshots" \
    KETOS_FEATURE_MVP_CHAT="$feature_flag" \
    STAGE05_RESTORE_ONLY="$restore_only" \
    npx playwright test tests/core/integrations/board-copilot-chat.spec.ts \
      --config=playwright.mvp.config.ts \
      --project=chromium \
      --grep "$title_pattern"
  )
}

run_browser_gate true false "real API and DB preserve two chats"
run_browser_gate false false "mvp_chat off hides UI"
run_browser_gate true true "mvp_chat re-enable restores"

git diff --check "$stage_base_sha"...HEAD
git diff --name-only "$stage_base_sha"...HEAD > "$run_root/changed-paths.txt"
if git diff --name-only "$stage_base_sha"...HEAD | rg \
  '(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|LICENSE|NOTICE)$|(^|/)(vendor|deploy|deployment|graphify-out)/'; then
  exit 1
fi
test -z "$(git status --porcelain)"
```

- [ ] **Step 2: Validate and commit the gate runner**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
bash -n scripts/mvp/run_stage05_recovery_gate.sh
chmod 755 scripts/mvp/run_stage05_recovery_gate.sh
git add scripts/mvp/run_stage05_recovery_gate.sh
git diff --cached --check
git commit -m "test(chat): add serial stage05 recovery gate"
```

Expected: syntax check and commit succeed; the script contains no credential value and writes only to the explicitly validated external run root.

- [ ] **Step 3: Freeze the product candidate and run the complete gate**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
export S05_BASE_SHA=1ea57de7aa88dc8cff2cc2818af8e69d3420542c
export S05_PRODUCT_CANDIDATE_SHA="$(git rev-parse HEAD)"
export S05_GATE_RUN_ROOT="$(mktemp -d "/Volumes/Projects/.ketos-stage05-gate.${S05_PRODUCT_CANDIDATE_SHA:0:12}.XXXXXX")"
test -z "$(git status --porcelain)"
source /Volumes/Projects/.ketos-stage04-runtime-20260719/connection.env
test -n "${MVP_POSTGRES_URI:-}"
set -o pipefail
{
  date -u '+started_at=%Y-%m-%dT%H:%M:%SZ'
  git rev-parse HEAD
  git rev-parse 'HEAD^{tree}'
  jq '.postgres_runtime' \
    /Volumes/Projects/.ketos-stage04-runtime-20260719/stage04-main-attestation.json
  ./scripts/mvp/run_stage05_recovery_gate.sh "$S05_GATE_RUN_ROOT"
  date -u '+finished_at=%Y-%m-%dT%H:%M:%SZ'
} 2>&1 | tee "$S05_GATE_RUN_ROOT/final-gate.log"
```

Expected: exit `0`; backend/migrations/runtime/frontend/build and all three controlled browser modes pass serially; browser screenshots and changed-path ledger remain external; repository status stays clean. If PostgreSQL is no longer accepting connections, recover only the same attested local disposable runtime. If safe recovery fails, record `BLOCKED` with the exact connection error rather than skipping.

- [ ] **Step 4: Run frontend, security, and independent integrated reviews**

Use the repository frontend code review, security review, Product Design audit, and run-review checklists. Review at least:

- effect/cleanup correctness under StrictMode and prop change;
- collision, retry, malformed-ID, and stale-binding behavior;
- outbound route remains `ketos-chat` while request `threadId` remains the durable UUID;
- no client-controlled provider/model/context or authorization expansion;
- no custom chat/protocol/runtime path;
- two-chat UI/DB isolation, replay, flag-off preservation, close/re-place, reload, focus, and reconnect;
- no secrets in logs, screenshots, audit text, or Git diff.

If a reviewer finds a defect, add a failing focused test, implement the smallest repair, commit it with `fix(chat): resolve reviewed stage05 recovery defect`, create a new candidate-named external run root, and rerun `run_stage05_recovery_gate.sh`. A review comment is not closed until its test and disposition are recorded.

- [ ] **Step 5: Verify the external ledger and bounded diff independently**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git diff --check "$S05_BASE_SHA"...HEAD
test -s "$S05_GATE_RUN_ROOT/changed-paths.txt"
test -s "$S05_GATE_RUN_ROOT/final-gate.log"
if git diff --name-only "$S05_BASE_SHA"...HEAD | rg \
  '(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|LICENSE|NOTICE)$|(^|/)(vendor|deploy|deployment|graphify-out)/'; then
  exit 1
fi
test -z "$(git status --porcelain)"
```

Expected: no prohibited path, no whitespace error, clean worktree.

---

### Task 8: Replace the blocker handoff with final evidence and close Stage 05 only

**Files:**

- Modify: `docs/dev/handoff/stage-05-durable-chat.md`
- Verify: `docs/evidence/stage-05/product-design/audit.md`
- Verify: `19_KETOS_STAGE_05_DURABLE_CHAT_COPILOTKIT_AG_UI.md`

**Interfaces:**

- Consumes: Task-7 product candidate SHA, serial-gate log, changed-path ledger, reviewer dispositions, and five Product Design artifacts.
- Produces: a placeholder-free Stage-05 handoff, a documentation closure commit, and final-SHA external acceptance proof; it authorizes but does not start Stage 06.

- [ ] **Step 1: Rewrite the handoff from fresh evidence**

Replace the historical `BLOCKED` verdict with a complete current report only after Task 7 is green. The handoff must include:

- Stage-04 base, blocked candidate, recovery design commit, product candidate SHA/tree, branch/worktree;
- resolved blocker: distinct local proxy IDs with fixed remote runtime ID;
- explicit official CopilotKit API evidence and no dependency/lock modification;
- recovery commit ledger and changed paths;
- command, exit code, tested SHA, and external artifact path for every serial gate;
- S05-A01–A10 status, with A07/A10 changed to `PASS` only from current evidence;
- separate C01–C17 `PASS/FAIL/BLOCKED` rows;
- five Product Design screenshots and audit limits;
- subagent/reviewer disposition that accurately follows the main-agent-only tool policy;
- rollback readiness: `mvp_chat=false` hides the surface without deleting Chat/Run/Message/Placement data; code rollback is a revert of the recovery commits and cannot retain Stage-05 PASS;
- `Stage 06 started: no`;
- `Transition S05 -> S06: GO` only when every row is `PASS`; otherwise `NO-GO` with the exact remaining defect/prerequisite.

Do not retain the old expected/received UUID pair as an active blocker; it may appear only in a short historical defect/resolution record.

- [ ] **Step 2: Validate documentation completeness mechanically**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
rg -n "S05-A0[1-9]|S05-A10|C0[1-9]|C1[0-7]|Transition S05|Stage 06 started|registerProxiedAgent|runtimeAgentId" \
  docs/dev/handoff/stage-05-durable-chat.md
if rg -n "<[^>]+>|TO[D]O|TB[D]|этап выполнен частично|этап заблокирован" \
  docs/dev/handoff/stage-05-durable-chat.md; then
  exit 1
fi
git diff --check
```

Expected for a PASS closure: all required ledgers are present and no placeholder/partial/blocked verdict remains.

- [ ] **Step 3: Commit the documentation closure**

Run:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
git add docs/dev/handoff/stage-05-durable-chat.md
git diff --cached --check
git commit -m "docs(chat): close stage05 recovery evidence"
export S05_FINAL_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
```

- [ ] **Step 4: Reverify the final closure SHA without modifying repository files**

Run the exact committed gate runner again:

```bash
cd /Volumes/Projects/ketos-mvp-stage05-integration
export S05_FINAL_SHA="$(git rev-parse HEAD)"
export S05_FINAL_VERIFY_ROOT="$(mktemp -d "/Volumes/Projects/.ketos-stage05-final.${S05_FINAL_SHA:0:12}.XXXXXX")"
source /Volumes/Projects/.ketos-stage04-runtime-20260719/connection.env
test -n "${MVP_POSTGRES_URI:-}"
set -o pipefail
{
  date -u '+started_at=%Y-%m-%dT%H:%M:%SZ'
  git rev-parse HEAD
  git rev-parse 'HEAD^{tree}'
  jq '.postgres_runtime' \
    /Volumes/Projects/.ketos-stage04-runtime-20260719/stage04-main-attestation.json
  ./scripts/mvp/run_stage05_recovery_gate.sh "$S05_FINAL_VERIFY_ROOT"
  git status --short --branch
  date -u '+finished_at=%Y-%m-%dT%H:%M:%SZ'
} 2>&1 | tee "$S05_FINAL_VERIFY_ROOT/final-gate.log"
```

Expected: exit `0`, final SHA/tree at the top of the external ledger, all serial gates green, external screenshots/changed paths present, and a clean final worktree. The external final attestation avoids the impossible self-referential requirement for a committed Markdown file to contain its own commit SHA. Record PostgreSQL runtime identity without credentials and the external ledger path in the Russian evidence report.

- [ ] **Step 5: Issue the Russian evidence report and stop**

Report:

- `этап выполнен` only if Tasks 7 and 8 are fully green on `S05_FINAL_SHA`;
- `этап выполнен частично` for an internal repairable failing criterion;
- `этап заблокирован` only for a proven external prerequisite that remains unavailable after safe recovery attempts.

Include final SHA/tree, dirty state, commit ledger, full gate summary, all reviewer findings/dispositions, Product Design artifacts, C01–C17 verdicts, and the exact transition verdict. Even with `GO`, do not begin Stage 06.

---

## Final Acceptance Matrix

| Blocker or gap | Required closure evidence | Failure verdict |
| --- | --- | --- |
| Shared mutable CopilotKit agent/thread | two local proxy IDs, one remote `ketos-chat`, two correct request `threadId` values, isolated UI and DB histories | `FAIL` |
| Proxy lifecycle leak/collision | StrictMode cleanup, prop-change cleanup, collision error/retry, malformed-ID rejection | `FAIL` |
| Custom/fallback chat path | stock `CopilotChat`, one provider, boundary guard, no custom renderer/protocol/runtime | `FAIL` |
| Invalid Vitest command | corrected Stage-05 command plus runtime test/typecheck/build exit `0` | `FAIL` |
| Missing browser evidence | main + flag-off + restore launches on one durable root, all exit `0` | `FAIL` |
| Missing Product Design states | five current-run screenshots and completed audit with evidence limits | `FAIL` |
| Persistence/auth regression | backend, replay, SQLite/PostgreSQL, owner/foreign, target-validation gates green | `FAIL` or proven external `BLOCKED` |
| Unbounded/dirty change | no prohibited path, `git diff --check` green, final status clean | `FAIL` |
| Stage boundary violation | Stage 06 remains unstarted; handoff alone records `GO/NO-GO` | `FAIL` |

The recovery is complete only when every matrix row and every original C01–C17 criterion is `PASS` on the frozen final closure SHA.
