"use client";

/** The top bar: the mode tabs, how the class link is doing, device sound, Class and the account. */
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/hooks/useStore";
import { api, classState, sound } from "@/services";
import type { Mode } from "@/services/link/messages";

const MODES: { mode: Mode; label: string; icon: "piano" | "music" }[] = [
  { mode: "piano", label: "Piano", icon: "piano" },
  { mode: "studio", label: "Studio", icon: "music" },
];

export interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onOpenClass: () => void;
  onOpenAccount: () => void;
}

export function Header({ mode, onModeChange, onOpenClass, onOpenAccount }: HeaderProps) {
  return (
    <header>
      <h1>ESP32 Piano</h1>
      <nav className="tabs" role="tablist" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.mode}
            role="tab"
            aria-selected={mode === m.mode}
            onClick={() => onModeChange(m.mode)}
          >
            <Icon name={m.icon} /> {m.label}
          </button>
        ))}
      </nav>
      <ConnectionStatus />
      <SoundToggle />
      <ClassButton onClick={onOpenClass} />
      <AccountButton onClick={onOpenAccount} />
    </header>
  );
}

/** "In class · board online", "Joining the class…", "Log in to join the class"… */
export function ConnectionStatus() {
  const { status, board, where } = useStore(classState.store);
  let text = status.text || "Not connected";
  if (status.state === "on" && where === "classroom" && board) {
    text += board.online ? " · board online" : " · board offline";
  }
  const state = status.state === "on" ? "connected" : status.state === "connecting" ? "connecting" : "idle";
  return (
    <div className="status" data-state={state}>
      <span className="dot" />
      <span>{text}</span>
    </div>
  );
}

function SoundToggle() {
  const on = useStore(sound.deviceSound, true);
  return (
    <button
      type="button"
      className="icon"
      aria-pressed={on}
      aria-label="Device sound"
      title={
        on
          ? "Device sound on: notes play on this phone/PC"
          : "Device sound off: silent here (the buzzer still plays if it's your turn)"
      }
      onClick={() => sound.setDeviceSound(!on)}
    >
      <Icon name={on ? "vol" : "mute"} />
    </button>
  );
}

function ClassButton({ onClick }: { onClick: () => void }) {
  const cls = useStore(classState.store);
  const live = !!cls.lesson.live;
  const inClass = cls.status.state === "on";
  return (
    <button
      type="button"
      className={live ? "primary class-btn live" : "primary class-btn"}
      title="The class: lesson, buzzer queue, students"
      disabled={!inClass && cls.where !== "online"}
      onClick={onClick}
    >
      <Icon name="class" /> Class
    </button>
  );
}

function AccountButton({ onClick }: { onClick: () => void }) {
  const user = useStore(api.session, null)?.user ?? null;
  return (
    <button
      type="button"
      title={user ? `Account (${user.role})` : "Log in or create an account"}
      onClick={onClick}
    >
      {user ? (
        <>
          <Icon name="user" /> {user.username}
        </>
      ) : (
        "Log in"
      )}
    </button>
  );
}
