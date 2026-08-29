# Food Waste Solutions — Surplus Prediction & Markdown Optimization

An intelligent inventory platform that predicts which grocery products are at risk of
becoming surplus, calculates the **minimum discount and optimal timing** needed to sell
them before they expire, and recommends the most profitable alternative (markdown,
inter-store transfer, or donation) when a straight discount won't clear the stock.

## Problem

Supermarkets already forecast demand. What they don't optimize well is the last mile:
*given a perishable product likely to go unsold, what's the smallest discount, applied
at the right moment, that clears it — without giving up margin unnecessarily?*

This project treats that as an explicit optimization problem: balancing
**revenue lost through discounting** against **revenue lost through waste**, at the
individual store level (a 30% discount that works in one store may be unnecessary — or
insufficient — in another).

## Real data vs. simulated data (read this before judging the numbers)

This is a portfolio project, not a live supermarket integration, so it's built on a
public dataset rather than a real retailer's POS feed. Being upfront about the
boundary between what's real and what's simulated:

- **Real**: daily unit sales, store-level price history, promotion flags, and calendar
  events come from the [M5 Forecasting - Accuracy](https://www.kaggle.com/competitions/m5-forecasting-accuracy)
  dataset (Walmart, 10 stores across 3 US states, ~1,900 days of history). Price
  fluctuations in this dataset are used to estimate **real, data-derived price
  elasticity** — i.e. how much a given discount actually moves units sold.
- **Simulated**: the dataset has no expiry dates or spoilage data (no public grocery
  dataset does, at SKU level, because retailers don't release it). A shelf-life model
  is layered on top of the FOODS category items, assigning realistic days-to-expiry by
  product family, so the "will this go to waste" question has something to bite on.

The forecasting and discount-response numbers are grounded in real retail behavior;
the surplus/expiry framing around them is a deliberate, disclosed simulation.

## Architecture

```
data/            raw + processed M5 data, shelf-life config
notebooks/       EDA, elasticity estimation, model development
backend/         FastAPI service — forecasting, risk scoring, optimization engine
frontend/        Next.js dashboard — store view, risk scores, recommended actions
docs/            case study write-up for the portfolio site
```

Pipeline:

1. **Forecast** baseline daily demand per store-item (LightGBM, lag/calendar/price features).
2. **Estimate elasticity** — how much a discount % lifts demand, from real price history.
3. **Simulate shelf life** — assign expiry countdowns to FOODS-category stock.
4. **Optimize** — solve for the minimum discount and timing that clears stock before
   expiry, per store-item.
5. **Score surplus risk** (Low/Medium/High/Critical) and recommend an action:
   monitor → markdown → inter-store transfer → donate.
6. **Serve** it through an API and a dashboard.

## Status

See the project task list for current build progress.
