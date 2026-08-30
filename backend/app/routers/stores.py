from fastapi import APIRouter, HTTPException
from typing import List

from database import get_connection
from schemas import StoreSummary

router = APIRouter(tags=["stores"])

STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"]


@router.get("/stores", response_model=List[StoreSummary])
def list_stores():
    con = get_connection()
    rows = con.execute("""
        SELECT
            store,
            count(*) AS total_items,
            sum(CASE WHEN risk_score = 'Low' THEN 1 ELSE 0 END) AS low,
            sum(CASE WHEN risk_score = 'Medium' THEN 1 ELSE 0 END) AS medium,
            sum(CASE WHEN risk_score = 'High' THEN 1 ELSE 0 END) AS high,
            sum(CASE WHEN risk_score = 'Critical' THEN 1 ELSE 0 END) AS critical,
            -- $ value of stock projected to go unsold if nothing is done,
            -- for the tiers where that's actually a live risk (High/Critical)
            round(sum(CASE WHEN risk_score IN ('High', 'Critical')
                THEN full_price * current_stock * (1 - do_nothing_sellthrough_pct / 100.0)
                ELSE 0 END), 2) AS potential_revenue_at_risk
        FROM risk_scores
        GROUP BY store
        ORDER BY store
    """).fetchall()
    cols = ["store", "total_items", "low", "medium", "high", "critical", "potential_revenue_at_risk"]
    return [StoreSummary(**dict(zip(cols, r))) for r in rows]


@router.get("/stores/{store}", response_model=StoreSummary)
def get_store(store: str):
    store = store.upper()
    if store not in STORES:
        raise HTTPException(status_code=404, detail=f"Unknown store '{store}'")
    con = get_connection()
    row = con.execute("""
        SELECT
            store, count(*),
            sum(CASE WHEN risk_score = 'Low' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'Medium' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'High' THEN 1 ELSE 0 END),
            sum(CASE WHEN risk_score = 'Critical' THEN 1 ELSE 0 END),
            round(sum(CASE WHEN risk_score IN ('High', 'Critical')
                THEN full_price * current_stock * (1 - do_nothing_sellthrough_pct / 100.0)
                ELSE 0 END), 2)
        FROM risk_scores WHERE store = ? GROUP BY store
    """, [store]).fetchone()
    cols = ["store", "total_items", "low", "medium", "high", "critical", "potential_revenue_at_risk"]
    return StoreSummary(**dict(zip(cols, row)))


@router.get("/stores/{store}/transfers")
def list_transfers(store: str):
    """Critical items at this store with a resolved transfer target elsewhere."""
    store = store.upper()
    con = get_connection()
    rows = con.execute("""
        SELECT item_id, product_name, barcode, current_stock, full_price, action
        FROM risk_scores
        WHERE store = ? AND risk_score = 'Critical' AND action LIKE 'Transfer to%'
        ORDER BY current_stock DESC
    """, [store]).fetchall()
    return [
        {"item_id": r[0], "product_name": r[1], "barcode": r[2], "current_stock": r[3],
         "full_price": r[4], "transfer_detail": r[5]}
        for r in rows
    ]
