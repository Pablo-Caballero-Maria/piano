"""Shared core of the piano-lessons system, used by the teacher's PC (``fog``) and by Vercel (``api``).

- :mod:`pianocore.crypto` — the system key: encryption of every stored record, ids, session keys.
- :mod:`pianocore.models` — users (teacher / student) and melodies (private / public), validated.
- :mod:`pianocore.auth` — password keys and signed session tokens.
- :mod:`pianocore.repo` — where records live: the interface, plus an in-memory store for tests.
- :mod:`pianocore.kv_repo` — records in a key/value store (the ESP32's flash, reached over MQTT).
- :mod:`pianocore.mongo_repo` — records in MongoDB Atlas.
- :mod:`pianocore.service` — accounts and melodies: the rules both servers apply.
- :mod:`pianocore.sync` — keeping a classroom board and Atlas in step.
- :mod:`pianocore.api` — the REST API (FastAPI router) both servers expose.
"""
