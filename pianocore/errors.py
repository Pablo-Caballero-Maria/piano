"""The error every rule raises when it refuses a request."""

from __future__ import annotations


class ServiceError(Exception):
    """A request the rules refuse: an HTTP-like status and a message for the user."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
