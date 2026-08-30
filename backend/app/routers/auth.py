from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError

from database import get_connection
from security import verify_password, create_access_token, decode_access_token
from schemas import Token, CurrentUser

router = APIRouter(tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


@router.post("/auth/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    con = get_connection()
    row = con.execute(
        "SELECT username, password_hash, store, display_name FROM users WHERE username = ?",
        [form_data.username],
    ).fetchone()
    if row is None or not verify_password(form_data.password, row[1]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                             detail="Incorrect username or password")
    username, _, store, display_name = row
    token = create_access_token(username, store)
    return Token(access_token=token, store=store, display_name=display_name)


def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        username = payload.get("sub")
        store = payload.get("store")
        if username is None or store is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    con = get_connection()
    row = con.execute("SELECT display_name FROM users WHERE username = ?", [username]).fetchone()
    if row is None:
        raise credentials_exception
    return CurrentUser(username=username, store=store, display_name=row[0])


@router.get("/auth/me", response_model=CurrentUser)
def me(current_user: CurrentUser = Depends(get_current_user)):
    return current_user
