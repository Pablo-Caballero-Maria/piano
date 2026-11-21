"use client";

/**
 * A modal dialog: the browser's own <dialog> (backdrop, Escape, focus), opened and closed by the
 * `open` prop. onClose runs whenever it closes (Escape, a button, or `open` turning false).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { BUTTON } from "@/components/ui/classes";
import { Icon } from "@/components/ui/Icon";

const DIALOG =
  "m-auto max-h-[calc(100dvh_-_32px)] rounded-[14px] border border-line bg-panel p-[18px] text-fg backdrop:bg-black/55";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  wide?: boolean;
  label?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, wide = false, label, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={
        wide
          ? `${DIALOG} h-[min(80dvh,640px)] w-[min(680px,calc(100vw_-_32px))] open:flex open:flex-col`
          : `${DIALOG} w-[min(380px,calc(100vw_-_32px))]`
      }
      aria-label={label}
      onClose={onClose}
    >
      {children}
    </dialog>
  );
}

/** A dialog's title with a close (×) button. */
export function ModalHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[17px] font-bold">{title}</h2>
      <button type="button" className={BUTTON.icon} aria-label="Close" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}
