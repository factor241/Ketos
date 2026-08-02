import type { InterruptResolveFn } from "@copilotkit/react-core/v2";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FlowCommandInterrupt } from "@/types/flow";
import FlowCommandPreview from "./FlowCommandPreview";

type ApprovalDecision = Readonly<{ approved: boolean }>;
const RECONNECT_REGISTRY_LIMIT = 256;

// Same-page remount protection only. The durable server proposal CAS remains
// authoritative across browser reloads and backend processes.
const activeResolutionIds = new Set<string>();
const presentedInterruptIds = new Set<string>();

function rememberBounded(registry: Set<string>, id: string): boolean {
  if (registry.has(id)) return false;
  registry.add(id);
  while (registry.size > RECONNECT_REGISTRY_LIMIT) {
    const oldest = registry.values().next().value;
    if (oldest === undefined) break;
    registry.delete(oldest);
  }
  return true;
}

export type FlowCommandConfirmationProps = Readonly<{
  commands: FlowCommandInterrupt[];
  resolve: InterruptResolveFn<ApprovalDecision>;
  onResolved?: (proposalId: string) => void;
}>;

export function FlowCommandConfirmation({
  commands,
  resolve,
  onResolved,
}: FlowCommandConfirmationProps) {
  const { t } = useTranslation();
  const initiallyActive = commands
    .map(({ interrupt }) => interrupt.id)
    .filter((id) => activeResolutionIds.has(id));
  const pendingRef = useRef(new Set(initiallyActive));
  const [pending, setPending] = useState<ReadonlySet<string>>(
    () => new Set(initiallyActive),
  );
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const firstCardRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [announceRestored, setAnnounceRestored] = useState(false);

  useEffect(() => {
    const fresh = commands.some(({ interrupt }) =>
      rememberBounded(presentedInterruptIds, interrupt.id),
    );
    if (fresh) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setAnnounceRestored(true);
      firstCardRef.current?.focus();
    }
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [commands]);

  useEffect(() => {
    const active = new Set(
      commands
        .map(({ interrupt }) => interrupt.id)
        .filter((id) => activeResolutionIds.has(id)),
    );
    pendingRef.current = active;
    setPending(active);
  }, [commands]);

  const decide = async (interruptId: string, approved: boolean) => {
    if (
      pendingRef.current.has(interruptId) ||
      activeResolutionIds.has(interruptId)
    )
      return;
    rememberBounded(activeResolutionIds, interruptId);
    pendingRef.current.add(interruptId);
    setPending(new Set(pendingRef.current));
    setFailed((current) => {
      const next = new Set(current);
      next.delete(interruptId);
      return next;
    });
    try {
      const resolution = resolve({ approved }, interruptId);
      const command = commands.find(
        (candidate) => candidate.interrupt.id === interruptId,
      );
      if (command) onResolved?.(command.metadata.proposalId);
      await resolution;
    } catch {
      activeResolutionIds.delete(interruptId);
      pendingRef.current.delete(interruptId);
      setPending(new Set(pendingRef.current));
      setFailed((current) => new Set(current).add(interruptId));
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      aria-label={t("flowCommand.openRequests")}
    >
      {announceRestored ? (
        <span className="sr-only" role="status" aria-live="polite">
          {t("flowCommand.restored")}
        </span>
      ) : null}
      {commands.map(({ interrupt, metadata }, index) => {
        const isPending = pending.has(interrupt.id);
        const isDismissed = dismissed.has(interrupt.id);
        const isActionable = metadata.preview.operationSummaries.some(
          (operation) => operation.status === "applied",
        );
        return (
          <Card
            ref={index === 0 ? firstCardRef : undefined}
            key={interrupt.id}
            role="region"
            aria-label={t("flowCommand.requestLabel")}
            aria-busy={isPending}
            tabIndex={-1}
            data-interrupt-id={interrupt.id}
            data-proposal-id={metadata.proposalId}
            className="bg-muted"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || isPending) return;
              setDismissed((current) => new Set(current).add(interrupt.id));
            }}
          >
            {isDismissed ? (
              <CardContent className="p-3">
                <Button
                  variant="outline"
                  size="sm"
                  ignoreTitleCase
                  onClick={() =>
                    setDismissed((current) => {
                      const next = new Set(current);
                      next.delete(interrupt.id);
                      return next;
                    })
                  }
                >
                  {t("flowCommand.reopen")}
                </Button>
              </CardContent>
            ) : (
              <>
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{t("flowCommand.title")}</CardTitle>
                      <CardDescription>
                        {t("flowCommand.description")}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDismissed((current) =>
                          new Set(current).add(interrupt.id),
                        )
                      }
                      aria-label={t("flowCommand.dismiss")}
                    >
                      {t("flowCommand.later")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <FlowCommandPreview preview={metadata.preview} />
                  {failed.has(interrupt.id) ? (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {t("flowCommand.submitError")}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    loading={isPending}
                    disabled={isPending || !isActionable}
                    ignoreTitleCase
                    onClick={() => void decide(interrupt.id, true)}
                  >
                    {t("flowCommand.approve")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isPending}
                    ignoreTitleCase
                    onClick={() => void decide(interrupt.id, false)}
                  >
                    {t("flowCommand.reject")}
                  </Button>
                  {isPending ? (
                    <span
                      role="status"
                      className="text-sm text-muted-foreground"
                    >
                      {t("flowCommand.busy")}
                    </span>
                  ) : null}
                </CardFooter>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default FlowCommandConfirmation;
