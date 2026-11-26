"use client";

/** A form field's problem (from its zod schema), under the field; it rises in when it appears. */
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { rise } from "@/lib/motion";

export function FieldError({ message }: { message: string | undefined }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <m.p key="error" {...rise} className="-mt-2 mb-2 text-[13px] text-danger">
          {message}
        </m.p>
      )}
    </AnimatePresence>
  );
}
