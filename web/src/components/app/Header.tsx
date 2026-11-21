"use client";

/** The top bar: the mode tabs, how the class link is doing, device sound, Class and the account. */
import { BUTTON } from "@/components/ui/classes";
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
    <header className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 short:px-3 short:py-1.5">
      <h1 className="text-[18px] font-[650] whitespace-nowrap narrow:hidden">ESP32 Piano</h1>
      <nav
        className="flex rounded-[10px] border border-line bg-panel p-0.5 [&_svg]:size-4 [&_svg]:align-[-3px]"
        role="tablist"
        aria-label="Mode"
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            className="rounded-lg border-0 bg-transparent px-3 py-[7px] text-muted aria-selected:bg-[#2e333d] aria-selected:text-fg narrow:px-[9px]"
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
  const dot = {
    connected: "bg-accent shadow-[0_0_8px_var(--color-accent)]",
    connecting: "animate-blink bg-warn",
    idle: "bg-muted",
  }[state];
  return (
    <div className="status mr-auto flex min-w-0 items-center gap-2 text-[14px] text-muted" data-state={state}>
      <span className={`size-2.5 flex-none rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}

function SoundToggle() {
  const on = useStore(sound.deviceSound, true);
  return (
    <button
      type="button"
      className={BUTTON.icon}
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
      className={
        live
          ? `${BUTTON.primary} relative after:absolute after:top-1 after:right-1 after:size-2 after:rounded-full after:bg-teacher`
          : BUTTON.primary
      }
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
