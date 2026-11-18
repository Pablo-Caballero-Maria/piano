/**
 * The real labels of the computer keys on this user's keyboard layout (A on QWERTY is Q on
 * AZERTY), if the browser tells us (Chrome's Keyboard Map API); null otherwise.
 */
import { Store } from "./store";

type LayoutMap = ReadonlyMap<string, string>;
interface NavigatorWithKeyboard {
  keyboard?: { getLayoutMap?: () => Promise<LayoutMap> };
}

export const keyboardLayout = new Store<LayoutMap | null>(null);
let asked = false;

/** Ask the browser once (call it in the browser, e.g. from an effect). */
export function loadKeyboardLayout(): void {
  if (asked || typeof navigator === "undefined") return;
  asked = true;
  (navigator as NavigatorWithKeyboard).keyboard
    ?.getLayoutMap?.()
    .then((map) => keyboardLayout.set(map))
    .catch(() => {});
}
