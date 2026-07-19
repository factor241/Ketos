import {
  type Interrupt,
  type InterruptResolveFn,
  useInterrupt,
} from "@copilotkit/react-core/v2";
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

type ApprovalDecision = Readonly<{ approved: boolean }>;

type InterruptCardsProps = Readonly<{
  interrupts: Interrupt[];
  resolve: InterruptResolveFn<ApprovalDecision>;
}>;

type DismissedInterruptContentProps = Readonly<{
  interruptId: string;
  onReopen: (interruptId: string) => void;
}>;

function DismissedInterruptContent({
  interruptId,
  onReopen,
}: DismissedInterruptContentProps) {
  const { t } = useTranslation();
  const reopenButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    reopenButtonRef.current?.focus();
  }, []);

  return (
    <CardContent className="p-4">
      <Button
        ref={reopenButtonRef}
        variant="outline"
        onClick={() => onReopen(interruptId)}
        aria-label={t("mvpApproval.reopenLabel", { id: interruptId })}
      >
        {t("mvpApproval.reopen")}
      </Button>
    </CardContent>
  );
}

function InterruptCards({ interrupts, resolve }: InterruptCardsProps) {
  const { t } = useTranslation();
  const pendingIdsRef = useRef(new Set<string>());
  const closeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusAfterReopenId, setFocusAfterReopenId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (focusAfterReopenId !== null && !dismissedIds.has(focusAfterReopenId)) {
      closeButtonRefs.current.get(focusAfterReopenId)?.focus();
      setFocusAfterReopenId(null);
    }
  }, [dismissedIds, focusAfterReopenId]);

  const dismiss = (interruptId: string) => {
    setDismissedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(interruptId);
      return nextIds;
    });
  };

  const reopen = (interruptId: string) => {
    setFocusAfterReopenId(interruptId);
    setDismissedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(interruptId);
      return nextIds;
    });
  };

  const submitDecision = async (
    interruptId: string,
    approved: boolean,
  ): Promise<void> => {
    if (pendingIdsRef.current.has(interruptId)) {
      return;
    }

    pendingIdsRef.current.add(interruptId);
    setPendingIds(new Set(pendingIdsRef.current));
    setFailedIds((currentIds) => {
      if (!currentIds.has(interruptId)) {
        return currentIds;
      }
      const nextIds = new Set(currentIds);
      nextIds.delete(interruptId);
      return nextIds;
    });

    try {
      await resolve({ approved }, interruptId);
    } catch {
      pendingIdsRef.current.delete(interruptId);
      setPendingIds(new Set(pendingIdsRef.current));
      setFailedIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.add(interruptId);
        return nextIds;
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      aria-label={t("mvpApproval.openRequests")}
    >
      {interrupts.map((interrupt) => {
        const isDismissed = dismissedIds.has(interrupt.id);
        const isPending = pendingIds.has(interrupt.id);
        const hasFailed = failedIds.has(interrupt.id);
        const trimmedMessage = interrupt.message?.trim();
        const summary = trimmedMessage ? trimmedMessage : interrupt.reason;

        return (
          <Card
            key={interrupt.id}
            role="region"
            aria-label={t("mvpApproval.requestLabel", { id: interrupt.id })}
            aria-busy={isPending}
            tabIndex={0}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === "Escape") {
                keyboardEvent.preventDefault();
                dismiss(interrupt.id);
              }
            }}
            className="bg-background"
          >
            {isDismissed ? (
              <DismissedInterruptContent
                interruptId={interrupt.id}
                onReopen={reopen}
              />
            ) : (
              <>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{t("mvpApproval.requestTitle")}</CardTitle>
                      <CardDescription className="break-all font-mono">
                        {interrupt.id}
                      </CardDescription>
                    </div>
                    <Button
                      ref={(element) => {
                        if (element) {
                          closeButtonRefs.current.set(interrupt.id, element);
                        } else {
                          closeButtonRefs.current.delete(interrupt.id);
                        }
                      }}
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(interrupt.id)}
                      aria-label={t("mvpApproval.closeLabel", {
                        id: interrupt.id,
                      })}
                    >
                      {t("mvpApproval.close")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p>{summary}</p>
                  {hasFailed ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {t("mvpApproval.submitError")}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="gap-2">
                  {isPending ? (
                    <span role="status" className="sr-only">
                      {t("mvpApproval.submitting")}
                    </span>
                  ) : null}
                  <Button
                    onClick={() => {
                      void submitDecision(interrupt.id, true);
                    }}
                    disabled={isPending}
                    aria-label={t("mvpApproval.approveLabel", {
                      id: interrupt.id,
                    })}
                  >
                    {t("mvpApproval.approve")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void submitDecision(interrupt.id, false);
                    }}
                    disabled={isPending}
                    aria-label={t("mvpApproval.rejectLabel", {
                      id: interrupt.id,
                    })}
                  >
                    {t("mvpApproval.reject")}
                  </Button>
                </CardFooter>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function CopilotKitInterruptProbe() {
  useInterrupt<ApprovalDecision, true>({
    agentId: "ketos-mvp-probe",
    renderInChat: true,
    render: ({ interrupts, resolve }) => (
      <InterruptCards interrupts={interrupts} resolve={resolve} />
    ),
  });

  return null;
}

export default CopilotKitInterruptProbe;
