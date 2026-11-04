// MongoDB Atlas connection shared by the API functions.
// The URI comes from the MONGODB_URI environment variable (Vercel project settings,
// or web/.env.local for the local dev server). Never hard-code it: the repo is public.
import { MongoClient } from "mongodb";

let dbPromise = null;

/** Connect once per server instance (reused across warm invocations) and return the database. */
export function getDb() {
  if (!dbPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    dbPromise = client
      .connect()
      .then(async () => {
        const db = client.db(process.env.MONGODB_DB || "piano");
        await Promise.all([
          db.collection("users").createIndex({ usernameLower: 1 }, { unique: true }),
          db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
          // MongoDB deletes expired sessions by itself
          db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
          db.collection("melodies").createIndex({ userId: 1, updatedAt: -1 }),
        ]);
        return db;
      })
      .catch((err) => {
        dbPromise = null; // retry on the next request
        client.close().catch(() => {});
        throw err;
      });
  }
  return dbPromise;
}
