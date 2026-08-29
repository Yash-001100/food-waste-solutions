"""
Not every per-store elasticity estimate is usable as-is. Apply a governance
rule before anything downstream (the discount optimizer) touches these
numbers: a store's estimate is only trusted if it's statistically
significant (p < 0.05) AND has the theoretically correct sign (negative -
demand falls as price rises). Stores that fail this get a pooled fallback
(the median of the valid stores) instead of their own noisy/wrong-signed
estimate.
"""
import json
import numpy as np
from pathlib import Path

PROC = Path(__file__).resolve().parents[1] / "data" / "processed" / "elasticity"

with open(PROC / "elasticity_by_store.json") as fh:
    raw = json.load(fh)

valid = {s: v for s, v in raw.items() if v["p_value"] < 0.05 and v["elasticity"] < 0}
invalid = {s: v for s, v in raw.items() if s not in valid}
fallback = float(np.median([v["elasticity"] for v in valid.values()]))

final = {}
for store, v in raw.items():
    if store in valid:
        final[store] = {**v, "used_elasticity": v["elasticity"], "source": "store_specific"}
    else:
        final[store] = {**v, "used_elasticity": round(fallback, 4), "source": "pooled_fallback"}

print(f"Valid store-specific estimates: {list(valid.keys())}")
print(f"Flagged as unreliable (pooled fallback used instead): {list(invalid.keys())}")
print(f"Pooled fallback elasticity: {fallback:.4f}")

with open(PROC / "elasticity_final.json", "w") as fh:
    json.dump({"fallback_elasticity": round(fallback, 4), "by_store": final}, fh, indent=2)
print("Saved elasticity_final.json")
