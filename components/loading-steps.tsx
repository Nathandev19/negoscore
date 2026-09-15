"use client";

import { useEffect, useState } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type LoadingStepsProps = {
  steps: readonly string[];
  durationMs: number;
  onDone: () => void;
};

export function LoadingSteps({ steps, durationMs, onDone }: LoadingStepsProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const stepMs = durationMs / steps.length;
    const timers = steps.map((_, index) =>
      setTimeout(() => {
        if (index + 1 < steps.length) setActive(index + 1);
        else onDone();
      }, stepMs * (index + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps, durationMs, onDone]);

  return (
    <ol className="flex flex-col gap-5" aria-live="polite">
      {steps.map((step, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li key={step} className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border",
                done && "border-neutral-900 bg-neutral-900 text-white",
                current && "border-neutral-900",
                !done && !current && "border-neutral-300",
              )}
            >
              {done ? (
                <CheckIcon className="size-4" />
              ) : current ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : null}
            </span>
            <span
              className={cn(
                "text-lg",
                current ? "font-semibold text-neutral-900" : "text-neutral-500",
                done && "text-neutral-900",
              )}
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
