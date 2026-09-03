"""
FastAPI entrypoint. Run with:
    cd backend/app && uvicorn main:app --reload --port 8000

Interactive API docs at /docs once running.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_connection
from routers import auth, stores, items, actions, analytics, inventory, transfers

app = FastAPI(
    title="Food Waste Solutions API",
    description="Surplus risk scores, discount recommendations, and countdown "
                 "schedules per store-item, plus a login + applied-action log "
                 "for store associates.",
    version="0.1.0",
)

# The Next.js dashboard (Task #9) runs on localhost during development;
# tighten this to the real deployed origin before this ever goes further
# than a demo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    get_connection()  # opens the DB connection, creates tables, registers parquet views


@app.get("/")
def root():
    return {"service": "food-waste-solutions-api", "status": "ok", "docs": "/docs"}


app.include_router(auth.router)
app.include_router(stores.router)
app.include_router(items.router)
app.include_router(actions.router)
app.include_router(analytics.router)
app.include_router(inventory.router)
app.include_router(transfers.router)
