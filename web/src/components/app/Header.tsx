"use client";

/** The top bar: the mode tabs, how the class link is doing, device sound, Class and the account. */
import { Music, Piano, User, Users, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { button, ICON } from "@/components/ui/classes";
import { useStore } from "@/hooks/useStore";
import { api, classState, sound } from "@/services";
import type { Mode } from "@/services/link/messages";

const MODES: { mode: Mode; label: string; icon: LucideIcon }[] = [
  { mode: "piano", label: "Piano", icon: Piano },
  { mode: "studio", label: "Studio", icon: Music },
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
            className={button("tab", "tab")}
            role="tab"
            aria-selected={mode === m.mode}
            onClick={() => onModeChange(m.mode)}
          >
            <m.icon className={ICON} /> {m.label}
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
      className={button("plain", "icon")}
      aria-pressed={on}
      aria-label="Device sound"
      title={
        on
          ? "Device sound on: notes play on this phone/PC"
          : "Device sound off: silent here (the buzzer still plays if it's your turn)"
      }
      onClick={() => sound.setDeviceSound(!on)}
    >
      {on ? <Volume2 className={ICON} /> : <VolumeX className={ICON} />}
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
          ? `${button("primary")} relative after:absolute after:top-1 after:right-1 after:size-2 after:rounded-full after:bg-teacher`
          : button("primary")
      }
      title="The class: lesson, buzzer queue, students"
      disabled={!inClass && cls.where !== "online"}
      onClick={onClick}
    >
      <Users className={ICON} /> Class
    </button>
  );
}

function AccountButton({ onClick }: { onClick: () => void }) {
  const user = useStore(api.session, null)?.user ?? null;
  return (
    <button
      type="button"
      className={button()}
      title={user ? `Account (${user.role})` : "Log in or create an account"}
      onClick={onClick}
    >
      {user ? (
        <>
          <User className={ICON} /> {user.username}
        </>
      ) : (
        "Log in"
      )}
    </button>
  );
}
