"use client";

/** The yes/no question asked with confirmDialog() (state/dialogs.ts). */
import { button, DIALOG_ROW } from "@/components/ui/classes";
import { useStore } from "@/hooks/useStore";
import { confirmStore } from "@/state/dialogs";
import { Modal } from "./Modal";

export function ConfirmDialog() {
  const request = useStore(confirmStore, null);
  const answer = (ok: boolean) => {
    if (!request) return;
    confirmStore.set(null);
    request.resolve(ok);
  };
  return (
    <Modal open={!!request} onClose={() => answer(false)} label="Confirm">
      <p className="my-[1em]">{request?.message}</p>
      <div className={DIALOG_ROW}>
        <button type="button" className={button()} onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className={button("primaryDanger")} onClick={() => answer(true)}>
          {request?.okLabel ?? "OK"}
        </button>
      </div>
    </Modal>
  );
}
