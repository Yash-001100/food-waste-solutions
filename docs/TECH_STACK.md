# Tech Stack — Food Waste Solutions

## Data & ML
- **Python 3.10**
- **pandas + DuckDB** — data pipeline: loading, filtering, reshaping the M5 dataset
- **LightGBM** — per-store-item demand forecasting (gradient boosting on tabular data, industry-standard for retail forecasting)
- **scikit-learn** — price-elasticity estimation, supporting model utilities
- **PyArrow / Parquet** — storage format for the processed dataset (compact, fast to reload)

## Backend
- **FastAPI** (Python) — serves model outputs as a REST API: surplus risk scores, recommended discount timing/amount, action recommendations (monitor / markdown / transfer / donate)

## Frontend
- **Next.js (React)** — the dashboard: store-level view of risk scores, recommended actions, and markdown curves. Deployable on Vercel alongside the existing portfolio site.

## Infra / Workflow
- **git** — version control, repo lives at `foodwastesolutions/food-waste-solutions` on Yash's machine (OneDrive-synced — see caveat below)
- **GitHub** — `github.com/Yash-001100`, pushed once the project is in a demoable state
- Deployment target (later, optional): Vercel for the frontend, Render/Railway/Fly.io for the FastAPI backend

## Why this stack
- LightGBM over deep learning: faster to train, easier to explain in an interview, and the standard choice for this kind of tabular retail-forecasting problem (this is what M5 competition winners used).
- FastAPI over Flask/Django: minimal boilerplate, built-in request validation, async-ready, pairs naturally with a Python ML backend.
- Next.js over plain React: matches the existing portfolio site's hosting (Vercel), server-side rendering if needed later, still just React underneath.

## Known caveat
The project folder lives inside OneDrive sync. OneDrive and git can occasionally
conflict over `.git` internals (lock files, rapid small writes). Not a blocker
so far, but if git starts behaving strangely, moving the repo to a
non-synced local folder is the fix.
