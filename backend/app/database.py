"""
DuckDB serves two different roles in this backend, deliberately:

1. READ side - the model's outputs (risk_scores.parquet, discount_recommendations
   .parquet, item_catalog.parquet) are registered as SQL VIEWS via DuckDB's
   read_parquet(), so the API queries them with plain SQL without ever loading
   14,370 rows into Python. This is DuckDB doing what it's actually built for.

2. WRITE side - two small native DuckDB tables, `users` and `applied_actions`,
   store the demo login accounts and the log of markdown/transfer/donate
   decisions a store associate actually clicks "Apply" on. DuckDB is an
   embedded, single-process OLAP engine - it supports transactional INSERT/
   UPDATE fine at this scale (a handful of demo users, a low-volume action
   log), but it is NOT built for concurrent multi-writer OLTP traffic the way
   Postgres is. That's a disclosed, deliberate trade-off for a portfolio-scale
   demo, not a production recommendation - worth saying exactly that if asked
   in an interview.
"""
import duckdb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data" / "processed"
DB_PATH = ROOT / "backend" / "app.duckdb"

_con = None


def get_connection():
    """Single shared DuckDB connection for the app's lifetime (DuckDB is
    single-process; FastAPI here runs with one worker, so this is safe)."""
    global _con
    if _con is None:
        _con = duckdb.connect(str(DB_PATH))
        _init_schema(_con)
        _register_views(_con)
    return _con


def _init_schema(con):
    con.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username    VARCHAR PRIMARY KEY,
            password_hash VARCHAR NOT NULL,
            store       VARCHAR NOT NULL,
            display_name VARCHAR NOT NULL
        )
    """)
    con.execute("""
        CREATE SEQUENCE IF NOT EXISTS applied_actions_id_seq START 1
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS applied_actions (
            id          BIGINT PRIMARY KEY DEFAULT nextval('applied_actions_id_seq'),
            store       VARCHAR NOT NULL,
            item_id     VARCHAR NOT NULL,
            action_type VARCHAR NOT NULL,
            discount_pct INTEGER,
            applied_by  VARCHAR NOT NULL,
            applied_at  TIMESTAMP NOT NULL DEFAULT current_timestamp,
            status      VARCHAR NOT NULL DEFAULT 'applied'
        )
    """)


def _register_views(con):
    con.execute(f"""
        CREATE OR REPLACE VIEW risk_scores AS
        SELECT * FROM read_parquet('{PROC / "risk_scores.parquet"}')
    """)
    con.execute(f"""
        CREATE OR REPLACE VIEW discount_recommendations AS
        SELECT * FROM read_parquet('{PROC / "discount_recommendations.parquet"}')
    """)
    con.execute(f"""
        CREATE OR REPLACE VIEW item_catalog AS
        SELECT * FROM read_parquet('{PROC / "item_catalog.parquet"}')
    """)
