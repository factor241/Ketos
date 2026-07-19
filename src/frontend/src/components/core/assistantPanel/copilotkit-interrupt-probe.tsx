import {
  type Interrupt,
  type InterruptResolveFn,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { useRef, useState } from "react";
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

function InterruptCards({ interrupts, resolve }: InterruptCardsProps) {
  const pendingIdsRef = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const dismiss = (interruptId: string) => {
    setDismissedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(interruptId);
      return nextIds;
    });
  };

  const reopen = (interruptId: string) => {
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
    <div className="flex flex-col gap-3" aria-label="Open approval requests">
      {interrupts.map((interrupt) => {
        const isDismissed = dismissedIds.has(interrupt.id);
        const isPending = pendingIds.has(interrupt.id);
        const hasFailed = failedIds.has(interrupt.id);

        return (
          <Card
            key={interrupt.id}
            role="region"
            aria-label={`Approval request ${interrupt.id}`}
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
              <CardContent className="p-4">
                <Button
                  variant="outline"
                  onClick={() => reopen(interrupt.id)}
                  aria-label={`Reopen approval request ${interrupt.id}`}
                >
                  Reopen approval request
                </Button>
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>Approval request</CardTitle>
                      <CardDescription className="break-all font-mono">
                        {interrupt.id}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(interrupt.id)}
                      aria-label={`Close approval request ${interrupt.id}`}
                    >
                      Close
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p>{interrupt.message ?? interrupt.reason}</p>
                  {hasFailed ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      Decision could not be submitted. Try again.
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    onClick={() => {
                      void submitDecision(interrupt.id, true);
                    }}
                    disabled={isPending}
                    aria-label={`Approve ${interrupt.id}`}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void submitDecision(interrupt.id, false);
                    }}
                    disabled={isPending}
                    aria-label={`Reject ${interrupt.id}`}
                  >
                    Reject
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
