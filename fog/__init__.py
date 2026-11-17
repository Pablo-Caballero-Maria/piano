"""The teacher's PC: the "fog" node of a piano class.

It serves the website to the phones of the teacher and the students (behind nginx, over HTTPS),
runs the live class (:mod:`fog.classroom`), drives the classroom board over MQTT
(:mod:`fog.board`), and, whenever it's online, syncs the board with MongoDB Atlas
(:mod:`fog.sync_service`), updates itself and the board from GitHub (:mod:`fog.updater`), keeps
its DuckDNS name pointing at it (:mod:`fog.internet`) and relays the lesson to Ably
(:mod:`fog.ably_bridge`). It keeps no database: accounts and melodies live on the board.

Run it with ``uv run python -m fog`` (deploy/ sets it up as a systemd service).
"""
