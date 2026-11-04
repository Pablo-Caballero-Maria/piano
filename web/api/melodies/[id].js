// /api/melodies/<id>: GET one of the user's melodies (with notes),
// PUT {name, bpm, notes} overwrites it, DELETE removes it.
// Another user's melody answers 404, the same as one that doesn't exist.
import { getDb } from "../../lib/db.js";
import { route, body, HttpError } from "../../lib/http.js";
import { requireUser } from "../../lib/auth.js";
import { parseMelody, parseId, lengthOf, toClient } from "../../lib/melody.js";

const NOT_FOUND = () => new HttpError(404, "Melody not found");

export default route({
  async GET(req) {
    const db = await getDb();
    const user = await requireUser(db, req);
    const m = await db.collection("melodies").findOne({ _id: parseId(req.query.id), userId: user._id });
    if (!m) throw NOT_FOUND();
    return { melody: toClient(m) };
  },

  async PUT(req) {
    const db = await getDb();
    const user = await requireUser(db, req);
    const melody = parseMelody(body(req));
    const m = await db.collection("melodies").findOneAndUpdate(
      { _id: parseId(req.query.id), userId: user._id },
      { $set: { ...melody, noteCount: melody.notes.length, length: lengthOf(melody.notes), updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!m) throw NOT_FOUND();
    return { melody: toClient(m) };
  },

  async DELETE(req) {
    const db = await getDb();
    const user = await requireUser(db, req);
    const r = await db.collection("melodies").deleteOne({ _id: parseId(req.query.id), userId: user._id });
    if (!r.deletedCount) throw NOT_FOUND();
    return { ok: true };
  },
});
