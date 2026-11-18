"use client";

/**
 * A modal dialog: the browser's own <dialog> (backdrop, Escape, focus), opened and closed by the
 * `open` prop. onClose runs whenever it closes (Escape, a button, or `open` turning false).
 */
import { useEffect, useRef, type ReactNode } from "react";

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
    <dialog ref={ref} className={wide ? "dlg wide" : "dlg"} aria-label={label} onClose={onClose}>
      {children}
    </dialog>
  );
}

/** A dialog's title with a close (×) button. */
export function ModalHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="dlg-head">
      <h2>{title}</h2>
      <button type="button" className="icon" aria-label="Close" onClick={onClose}>
        <svg className="ic" aria-hidden="true">
          <use href="#i-x" />
        </svg>
      </button>
    </div>
  );
}
