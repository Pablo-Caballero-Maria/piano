// Every browser module loads and has the exports the others import (main.js needs the page).
import { test } from "node:test";
import assert from "node:assert/strict";

const exports = {
  "api.js": ["config", "currentUser", "login", "register", "logout", "listMelodies", "createMelody", "updateMelody"],
  "link.js": ["on", "start", "stop", "note", "activity", "live", "studio", "queue", "follow", "lessons", "where"],
  "class.js": ["init", "onChange", "status", "lesson", "board", "amLive", "watchingLesson", "toggleLive"],
  "sound.js": ["output", "deviceSound", "setDeviceSound", "unlockAudio", "click"],
  "studio.js": ["initStudio", "setStudioActive", "studioKeyDown", "studioKeyUp", "panic", "onStudioChange",
    "studioState", "studioDetail", "followTeacher", "setTeacherNotes"],
  "keyboard.js": ["Keyboard"],
  "ui.js": ["icon", "toast", "confirmDialog", "openAuth", "initAuthDialog"],
};

for (const [file, names] of Object.entries(exports)) {
  test(file, async () => {
    const mod = await import(`../../web/public/js/${file}`);
    for (const name of names) assert.equal(typeof mod[name], "function", `${file} exports ${name}`);
  });
}
