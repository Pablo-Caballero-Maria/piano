// /api/melodies: GET lists the logged-in user's melodies (newest first, without notes),
// POST {name, bpm, notes} saves a new one.
import { getDb } from "../../lib/db.js";
import { route, body, HttpError } from "../../lib/http.js";
import { requireUser } from "../../lib/auth.js";
import { parseMelody, lengthOf, toClient, MAX_MELODIES } from "../../lib/melody.js";

export default route({
  async GET(req) {
    const db = await getDb();
    const user = await requireUser(db, req);
    const list = await db
      .collection("melodies")
      .find({ userId: user._id }, { projection: { notes: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return { melodies: list.map((m) => toClient(m, false)) };
  },

  async POST(req, res) {
    const db = await getDb();
    const user = await requireUser(db, req);
    const melody = parseMelody(body(req));
    if ((await db.collection("melodies").countDocuments({ userId: user._id })) >= MAX_MELODIES)
      throw new HttpError(400, `You can keep at most ${MAX_MELODIES} melodies; delete some first`);
    const now = new Date();
    const doc = { userId: user._id, ...melody, noteCount: melody.notes.length, length: lengthOf(melody.notes), createdAt: now, updatedAt: now };
    doc._id = (await db.collection("melodies").insertOne(doc)).insertedId;
    res.statusCode = 201;
    return { melody: toClient(doc) };
  },
});
