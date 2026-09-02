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

_base_con = None


def get_connection():
    """
    Returns a DuckDB handle safe for the calling request to use on its own.

    FastAPI runs each sync endpoint in its own worker thread, and the
    frontend routinely fires more than one request at once (the risk board
    page loads the store summary and the item list in parallel). A single
    duckdb.Connection is NOT safe to use concurrently from multiple threads -
    queries interleave on the same cursor state, and one request can get
    back another request's (or a mix of two requests') rows. This surfaced
    during frontend integration testing as `/stores/{store}` intermittently
    returning garbled data (once literally an item_id where a row count was
    expected) under concurrent load - a real bug, not a fluke.

    The fix is DuckDB's documented pattern for this: keep ONE base
    connection for the process (schema + parquet views are set up on it
    once), and hand out a fresh `.cursor()` per call. A cursor is cheap
    (shares the same underlying database, no data is re-read) and is
    independently safe to use from a different thread.
    """
    global _base_con
    if _base_con is None:
        _base_con = duckdb.connect(str(DB_PATH))
        _init_schema(_base_con)
        _register_views(_base_con)
    return _base_con.cursor()


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
    # Migration: value_saved was added after the table above first shipped.
    # `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` looks like the obvious way to
    # keep this safe against an already-populated app.duckdb, but DuckDB
    # 1.5.5 has a WAL-replay bug on exactly that statement: if the process
    # exits before its next checkpoint, reopening the database replays the
    # WAL and crashes with an internal "GetDefaultDatabase with no default
    # database set" error - reproduced directly while building this feature.
    # Checking the column's existence in Python first and issuing a plain
    # `ADD COLUMN` (no `IF NOT EXISTS`) only when needed avoids the buggy
    # code path entirely.
    existing_cols = {r[1] for r in con.execute("PRAGMA table_info('applied_actions')").fetchall()}
    if "value_saved" not in existing_cols:
        con.execute("ALTER TABLE applied_actions ADD COLUMN value_saved DOUBLE")
        # Flush the ALTER to the main database file immediately instead of
        # leaving it sitting in the WAL for the rest of the process's life -
        # that's the window where the replay bug above gets hit (an unclean
        # kill/crash any time before the next natural checkpoint). This
        # doesn't close the window to zero (a kill in the split second
        # between the ALTER and this CHECKPOINT is still theoretically
        # possible), but it shrinks it from "indefinite" to "sub-second,"
        # which is an acceptable, disclosed trade-off for a demo-scale app.
        con.execute("CHECKPOINT")
    # stock_at_action - added for the analytics Transaction Log (Task #10),
    # which needs a real, frozen "how much stock was this action about"
    # number. current_stock on risk_scores is a live join and would silently
    # drift if it ever changed, misrepresenting past actions - this is
    # captured once, at apply time (see actions.py), rather than joined
    # live. Same migration pattern as value_saved above, checked against the
    # same pre-ALTER column snapshot.
    if "stock_at_action" not in existing_cols:
        con.execute("ALTER TABLE applied_actions ADD COLUMN stock_at_action DOUBLE")
        con.execute("CHECKPOINT")


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
    # Real M5 daily sales + price history (Task #01_build_dataset.py output),
    # one parquet per store - globbed into a single view. This is genuine
    # per-day unit sales and store price history, not a forecast or
    # simulation (see README's real-vs-simulated section).
    con.execute(f"""
        CREATE OR REPLACE VIEW daily_sales AS
        SELECT store_id AS store, item_id, date, qty, sell_price
        FROM read_parquet('{PROC / "foods_long_*.parquet"}')
    """)
    # Real discount-response buckets (05_price_elasticity.py output): for
    # each store, the actual normalized average quantity sold at each real
    # discount depth observed in the M5 data. One CSV per store with no
    # store column of its own, so the store is recovered from the filename
    # DuckDB's CSV reader attaches when filename=true.
    con.execute(f"""
        CREATE OR REPLACE VIEW discount_response AS
        SELECT regexp_extract(filename, 'discount_response_([A-Z0-9_]+)\\.csv$', 1) AS store,
               bucket, price_ratio_range, n_obs, mean_qty_norm
        FROM read_csv_auto('{PROC / "elasticity" / "discount_response_*.csv"}', filename=true)
    """)
