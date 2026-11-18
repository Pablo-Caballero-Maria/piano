import { useEffect, useState } from "react";
import { KeyboardController, type KeyboardHandlers } from "@/lib/keyboard-controller";

/** A KeyboardController for this component's life, calling the latest handlers. */
export function useKeyboard(handlers: KeyboardHandlers, octave = 4): KeyboardController {
  const [controller] = useState(() => new KeyboardController(handlers, octave));
  useEffect(() => controller.setHandlers(handlers));
  return controller;
}
