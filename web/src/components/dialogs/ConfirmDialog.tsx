"use client";

/** The yes/no question asked with confirmDialog() (state/dialogs.ts). */
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
      <p>{request?.message}</p>
      <div className="row">
        <button type="button" onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className="primary danger" onClick={() => answer(true)}>
          {request?.okLabel ?? "OK"}
        </button>
      </div>
    </Modal>
  );
}
