import secrets
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import Cookie, Depends, FastAPI, Form, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import auth

app = FastAPI(title="Tobo List")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Init Excel user store on boot
auth.init_users_file()

# Per-user in-memory todo store: {user_id: [todo, ...]}
todos_db: dict[str, List[dict]] = {}
# Session store: {token: user_id}
sessions: dict[str, str] = {}
SESSION_COOKIE = "tobo_session"


# ---------- Models ----------
class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Optional[str] = "medium"
    category: Optional[str] = "personal"
    due_date: Optional[str] = None


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[str] = None
    category: Optional[str] = None
    due_date: Optional[str] = None


# ---------- Auth dependency ----------
def current_user(request: Request, tobo_session: Optional[str] = Cookie(None)) -> dict:
    """Resolve the user for a given session cookie; raise 401 if missing/invalid."""
    if tobo_session and tobo_session in sessions:
        user_id = sessions[tobo_session]
        for u in auth.list_users():
            if u["id"] == user_id:
                return {"id": u["id"], "username": u["username"]}
    raise HTTPException(status_code=401, detail="Not authenticated")


def optional_user(tobo_session: Optional[str] = Cookie(None)) -> Optional[dict]:
    if tobo_session and tobo_session in sessions:
        user_id = sessions[tobo_session]
        for u in auth.list_users():
            if u["id"] == user_id:
                return {"id": u["id"], "username": u["username"]}
    return None


# ---------- Pages ----------
@app.get("/", response_class=HTMLResponse)
async def home(request: Request, user: Optional[dict] = Depends(optional_user)):
    if not user:
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("index.html", {"request": request, "user": user})


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, user: Optional[dict] = Depends(optional_user)):
    if user:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


# ---------- Auth endpoints ----------
@app.post("/api/auth/register")
async def register(username: str = Form(...), password: str = Form(...)):
    username = username.strip()
    if len(username) < 3 or len(username) > 30:
        raise HTTPException(400, "Username must be 3–30 characters")
    if len(password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    user = auth.create_user(username, password)
    if not user:
        raise HTTPException(409, "Username already exists")
    return {"ok": True, "username": user["username"]}


@app.post("/api/auth/login")
async def login(response: Response, username: str = Form(...), password: str = Form(...)):
    user = auth.authenticate(username, password)
    if not user:
        raise HTTPException(401, "Invalid username or password")
    token = secrets.token_urlsafe(32)
    sessions[token] = user["id"]
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,  # 7 days
    )
    return {"ok": True, "username": user["username"]}


@app.post("/api/auth/logout")
async def logout(response: Response, tobo_session: Optional[str] = Cookie(None)):
    if tobo_session and tobo_session in sessions:
        sessions.pop(tobo_session, None)
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict = Depends(current_user)):
    return user


# ---------- Todo endpoints (per-user) ----------
def _user_todos(user_id: str) -> List[dict]:
    return todos_db.setdefault(user_id, [])


@app.get("/api/todos")
async def get_todos(
    category: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    completed: Optional[bool] = None,
    user: dict = Depends(current_user),
):
    result = list(_user_todos(user["id"]))
    if category and category != "all":
        result = [t for t in result if t["category"] == category]
    if priority and priority != "all":
        result = [t for t in result if t["priority"] == priority]
    if search:
        q = search.lower()
        result = [t for t in result if q in t["title"].lower() or q in t.get("description", "").lower()]
    if completed is not None:
        result = [t for t in result if t["completed"] == completed]
    return result


@app.post("/api/todos", status_code=201)
async def create_todo(todo: TodoCreate, user: dict = Depends(current_user)):
    new_todo = {
        "id": str(uuid.uuid4()),
        "title": todo.title,
        "description": todo.description,
        "priority": todo.priority,
        "category": todo.category,
        "due_date": todo.due_date,
        "completed": False,
        "pinned": False,
        "created_at": datetime.now().isoformat(),
    }
    _user_todos(user["id"]).append(new_todo)
    return new_todo


@app.patch("/api/todos/{todo_id}")
async def update_todo(todo_id: str, update: TodoUpdate, user: dict = Depends(current_user)):
    for todo in _user_todos(user["id"]):
        if todo["id"] == todo_id:
            for field, value in update.model_dump(exclude_none=True).items():
                todo[field] = value
            todo["updated_at"] = datetime.now().isoformat()
            return todo
    raise HTTPException(status_code=404, detail="Todo not found")


@app.patch("/api/todos/{todo_id}/pin")
async def toggle_pin(todo_id: str, user: dict = Depends(current_user)):
    for todo in _user_todos(user["id"]):
        if todo["id"] == todo_id:
            todo["pinned"] = not todo.get("pinned", False)
            return todo
    raise HTTPException(status_code=404, detail="Todo not found")


@app.delete("/api/todos/{todo_id}")
async def delete_todo(todo_id: str, user: dict = Depends(current_user)):
    bucket = _user_todos(user["id"])
    for i, todo in enumerate(bucket):
        if todo["id"] == todo_id:
            bucket.pop(i)
            return {"message": "Deleted"}
    raise HTTPException(status_code=404, detail="Todo not found")


@app.delete("/api/todos/completed/clear")
async def clear_completed(user: dict = Depends(current_user)):
    bucket = _user_todos(user["id"])
    removed = len([t for t in bucket if t["completed"]])
    todos_db[user["id"]] = [t for t in bucket if not t["completed"]]
    return {"message": f"Cleared {removed} completed tasks"}


@app.get("/api/stats")
async def get_stats(user: dict = Depends(current_user)):
    bucket = _user_todos(user["id"])
    total = len(bucket)
    completed = len([t for t in bucket if t["completed"]])
    pinned = len([t for t in bucket if t.get("pinned")])
    by_category: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    for t in bucket:
        by_category[t["category"]] = by_category.get(t["category"], 0) + 1
        by_priority[t["priority"]] = by_priority.get(t["priority"], 0) + 1
    return {
        "total": total,
        "completed": completed,
        "pending": total - completed,
        "pinned": pinned,
        "completion_rate": round((completed / total * 100) if total else 0, 1),
        "by_category": by_category,
        "by_priority": by_priority,
    }


# Custom 401 handler for HTML pages (redirect instead of JSON for browser nav)
@app.exception_handler(HTTPException)
async def auth_redirect(request: Request, exc: HTTPException):
    if exc.status_code == 401 and not request.url.path.startswith("/api/"):
        return RedirectResponse("/login", status_code=303)
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
