"""
Seed one demo store-associate login per store (10 total).

Real supermarkets have proper staff directories and SSO; there's no such
thing to plug into here, so these are clearly-labeled demo accounts -
username = store code, password = "foodwaste2026" for every account. This
is fine for a portfolio demo; it would not be fine anywhere real.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "app"))
from database import get_connection
from security import hash_password

DEMO_PASSWORD = "foodwaste2026"

STORES = ["CA_1", "CA_2", "CA_3", "CA_4", "TX_1", "TX_2", "TX_3", "WI_1", "WI_2", "WI_3"]


def main():
    con = get_connection()
    password_hash = hash_password(DEMO_PASSWORD)
    for store in STORES:
        username = store.lower()
        display_name = f"{store} Associate"
        con.execute("""
            INSERT INTO users (username, password_hash, store, display_name)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash
        """, [username, password_hash, store, display_name])
    n = con.execute("SELECT count(*) FROM users").fetchone()[0]
    print(f"Seeded/updated {len(STORES)} demo users. Total users in DB: {n}")
    print(f"Login with username = store code lowercase (e.g. 'ca_1'), password = '{DEMO_PASSWORD}'")


if __name__ == "__main__":
    main()
