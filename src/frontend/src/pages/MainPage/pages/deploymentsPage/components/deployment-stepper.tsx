import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/utils";
import { useDeploymentStepper } from "../contexts/deployment-stepper-context";

export const CREATE_STEPS = [
  { number: 1, labelKey: "deployments.provider" },
  { number: 2, labelKey: "deployments.labelType" },
  { number: 3, labelKey: "deployments.stepFlows" },
  { number: 4, labelKey: "deployments.review" },
] as const;

export const CREATE_DEPLOYED_STEPS = [
  { number: 1, labelKey: "deployments.provider" },
  { number: 2, labelKey: "deployments.labelType" },
  { number: 3, labelKey: "deployments.stepFlows" },
  { number: 4, labelKey: "deployments.deployed" },
] as const;

const EDIT_STEPS = [
  { number: 1, labelKey: "deployments.labelType" },
  { number: 2, labelKey: "deployments.stepFlows" },
  { number: 3, labelKey: "deployments.review" },
] as const;

export const DEPLOYMENT_STEPS = CREATE_STEPS;

type DeploymentStepLabelKey =
  | "deployments.provider"
  | "deployments.labelType"
  | "deployments.stepFlows"
  | "deployments.review"
  | "deployments.deployed";

function translateStepLabel(t: TFunction, labelKey: DeploymentStepLabelKey) {
  switch (labelKey) {
    case "deployments.provider":
      return t("deployments.provider");
    case "deployments.labelType":
      return t("deployments.labelType");
    case "deployments.stepFlows":
      return t("deployments.stepFlows");
    case "deployments.review":
      return t("deployments.review");
    case "deployments.deployed":
      return t("deployments.deployed");
  }
}

interface DeploymentStepperProps {
  steps?: readonly { number: number; labelKey: DeploymentStepLabelKey }[];
  currentStepOverride?: number;
}

export default function DeploymentStepper({
  steps: stepsProp,
  currentStepOverride,
}: DeploymentStepperProps) {
  const { t } = useTranslation();
  const { currentStep, isEditMode } = useDeploymentStepper();
  const steps = stepsProp ?? (isEditMode ? EDIT_STEPS : CREATE_STEPS);
  const activeStep = currentStepOverride ?? currentStep;
  const progressPercent = ((activeStep - 1) / (steps.length - 1)) * 100;

  return (
    <div className="relative mx-auto h-[52px] w-full max-w-[700px]">
      <div className="absolute left-4 right-4 top-4 h-[2px] bg-muted">
        <div
          className="h-full bg-foreground transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="relative flex h-full items-start justify-between">
        {steps.map((step) => (
          <div key={step.number} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                activeStep >= step.number
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {step.number}
            </div>
            <span
              className={cn(
                "whitespace-nowrap text-xs text-foreground",
                activeStep >= step.number && "font-medium",
              )}
            >
              {translateStepLabel(t, step.labelKey)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
