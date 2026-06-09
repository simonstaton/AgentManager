"use client";

import type { FC } from "react";
import { cn } from "@/lib/utils";

const STEPS = ["input", "preview", "running", "done"] as const;
type WorkflowStep = (typeof STEPS)[number];

const STEP_LABELS: Record<WorkflowStep, string> = {
  input: "Input",
  preview: "Preview",
  running: "Running",
  done: "Done",
};

export interface WorkflowStepperProps {
  currentStep: WorkflowStep;
  className?: string;
}

/**
 * Horizontal step indicator for the workflow wizard.
 * Completed steps use emerald; active step uses indigo; upcoming steps are muted zinc.
 */
export const WorkflowStepper: FC<WorkflowStepperProps> = ({ currentStep, className }) => {
  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <div
      className={cn("flex items-center mb-6", className)}
      role="navigation"
      aria-label={`Workflow progress: ${STEP_LABELS[currentStep]}, step ${currentIndex + 1} of ${STEPS.length}`}
    >
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isActive = step === currentStep;

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Circle + inline label */}
            <div className="flex items-center">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                  isDone && "bg-emerald-600 text-white",
                  isActive && "bg-indigo-600 text-white",
                  !isDone && !isActive && "bg-zinc-800 border border-zinc-600 text-zinc-500",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span className="sr-only">
                  {isDone
                    ? `${STEP_LABELS[step]}: completed`
                    : isActive
                      ? `${STEP_LABELS[step]}: current step`
                      : `${STEP_LABELS[step]}: upcoming`}
                </span>
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M2.5 7l3 3 6-6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
              </div>
              <span
                className={cn("ml-2 text-xs font-medium hidden sm:block", isActive ? "text-zinc-100" : "text-zinc-500")}
                aria-hidden="true"
              >
                {STEP_LABELS[step]}
              </span>
            </div>

            {/* Connector line (not after last step) */}
            {index < STEPS.length - 1 && (
              <div
                className={cn("flex-1 h-px mx-3", isDone ? "bg-emerald-700/50" : "bg-zinc-700")}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
