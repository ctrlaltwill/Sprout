# Charts

Last updated: 13/02/2026

## Overview

The [[Analytics]] dashboard includes several charts to visualise your study data. This page explains what each chart shows, how to read it, and how filter settings affect the displayed data.

## Review Calendar Heatmap

A 365-day grid (7 rows × 52 weeks) coloured by review activity. Each cell is one day.

- **Darker cells** = more reviews that day.
- **Hover** over a cell to see the exact date and review count.
- Use this to spot study patterns, gaps, and consistency.

## Stage Distribution

A pie chart showing how your cards are distributed across scheduling stages:

| Segment | Meaning |
|---------|---------|
| **New** | Cards never reviewed |
| **Learning** | Cards in initial learning steps |
| **Review** | Cards graduated to the review queue |
| **Relearning** | Cards that were forgotten and re-entered learning |
| **Suspended** | Cards removed from reviews |

This gives you a snapshot of your collection's health — a high proportion of Review cards means your collection is maturing.

## Future Due (Study Forecast)

A 30-day bar chart forecasting how many cards will become due each day. Use this to:

- Anticipate heavy review days.
- Plan when to add new cards.
- Spot if your workload is growing unsustainably.

## Answer Buttons

A 30-day stacked bar chart showing how many times you pressed each grade button per day:

- **Again** (red) — Forgotten cards
- **Hard** (orange) — Difficult recalls (four-button mode only)
- **Good** (green) — Successful recalls
- **Easy** (blue) — Effortless recalls (four-button mode only)

A high proportion of Again presses may indicate cards that need rewriting or difficulty settings that need adjusting.

## New Cards Per Day

A 30-day chart of how many new cards were introduced each day. Useful for tracking your card creation pace and ensuring you're not overwhelming yourself with new material.

## Stability Distribution

A histogram of card stability values across your collection.

- **X-axis**: Stability in days.
- **Y-axis**: Number of cards.
- Higher stability means the card has longer intervals and is well-learned.
- Cards clustered at low stability values may need more frequent review or better content.

## Forgetting Curve

Plots your actual retention (percentage of correct recalls) against the theoretical FSRS forgetting curve.

- **Theoretical curve** — Shows the expected recall probability at each interval.
- **Actual data points** — Shows your real performance at different intervals.

If your actual retention consistently falls below the curve, consider raising your requested retention in [[Scheduling|scheduling settings]]. If it's consistently above, you could lower retention to reduce workload.

## Filter effects

All charts respond to the dashboard's global filters:

- **Time range** filters — Limit data to a specific period.
- **Scope filters** — Show data only for specific decks or groups.

When filters are active, a badge appears in the filter bar showing the active filter count.
