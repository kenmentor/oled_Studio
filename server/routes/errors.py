"""Shared route helpers: consistent error envelope."""

from __future__ import annotations

from fastapi import HTTPException


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})
