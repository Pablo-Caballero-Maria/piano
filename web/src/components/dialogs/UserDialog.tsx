"use client";

/** The logged-in user: who they are, and Log out. */
import { DIALOG_ROW, MUTED_P } from "@/components/ui/classes";
import { Icon } from "@/components/ui/Icon";
import { api, type User } from "@/services/api";
import { toast } from "@/state/toast";
import { Modal } from "./Modal";

const ROLE_TEXT = {
  teacher: "Teacher: you can give lessons, see your students and manage the buzzer.",
  student: "Student: you can follow lessons and ask for the buzzer.",
} as const;

export function UserDialog({
  user,
  open,
  onClose,
}: {
  user: User | null;
  open: boolean;
  onClose: () => void;
}) {
  const logout = () => {
    onClose();
    api.logout();
    toast("Logged out");
  };
  return (
    <Modal open={open && !!user} onClose={onClose} label="Account">
      <h2 className="mb-3 text-[17px] font-bold">
        <Icon name="user" /> <span>{user?.username}</span>
      </h2>
      <p className={MUTED_P}>{user ? ROLE_TEXT[user.role] : ""}</p>
      <div className={DIALOG_ROW}>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
    </Modal>
  );
}
