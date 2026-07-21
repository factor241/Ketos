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
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const firstCardRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstCardRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  const decide = async (interruptId: string, approved: boolean) => {
    if (pendingRef.current.has(interruptId)) return;
    pendingRef.current.add(interruptId);
    setPending(new Set(pendingRef.current));
    try {
      const resolution = resolve({ approved }, interruptId);
      const command = commands.find(
        (candidate) => candidate.interrupt.id === interruptId,
      );
      if (command) onResolved?.(command.metadata.proposalId);
      await resolution;
    } catch {
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
