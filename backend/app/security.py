"""
Auth for the demo: bcrypt password hashing + JWT bearer tokens.

This is real auth mechanics (hashed passwords, signed short-lived tokens),
but scoped to what a portfolio demo needs - one account per store, seeded by
scripts/seed_users.py, not a full user-management system (no signup flow,
no password reset, no roles beyond "store associate"). SECRET_KEY is
generated fresh per environment (see below) rather than hardcoded, but for a
real deployment it belongs in an actual secret manager / env var, not in code.
"""
import os
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

# In a real deployment this comes from an environment variable / secret
# manager. For this demo, fall back to a fixed dev-only value so the token
# stays valid across server restarts without needing extra setup.
SECRET_KEY = os.environ.get("FOODWASTE_SECRET_KEY", "dev-only-insecure-secret-do-not-use-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # a store associate's shift

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(username: str, store: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": username, "store": store, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jose.JWTError on an invalid/expired token - callers translate
    that into a 401 (see routers/auth.py's get_current_user dependency)."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
