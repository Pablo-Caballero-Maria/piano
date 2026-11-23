"""A stand-in for Better Auth's Node server in tests/fog/test_auth_server.py: answers /api/auth/ok,
and echoes any other request (method, path, headers, body) with two cookies set."""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def _answer(self) -> None:
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path == "/api/auth/ok":
            out = b'{"ok":true}'
        else:
            out = json.dumps(
                {
                    "method": self.command,
                    "path": self.path,
                    "headers": dict(self.headers),
                    "body": body.decode(),
                }
            ).encode()
        self.send_response(418 if self.path.endswith("/teapot") else 200)
        self.send_header("content-type", "application/json")
        self.send_header("set-cookie", "a=1")
        self.send_header("set-cookie", "b=2")
        self.send_header("set-auth-token", "tok.sig")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    do_GET = do_POST = _answer

    def log_message(self, *args: object) -> None:
        print("request", *args, flush=True)


HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
