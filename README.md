# Mathesis

AI-generated practice math worksheets, with eval discipline built in from day one.

## The problem

My kid's math curriculum publishes one lesson per week: a fixed set of problems, no way to generate more practice at the same difficulty or focused on the concepts they're still working through. The available options aren't great: print the same lesson again (not a value add), buy a generic workbook (off-target), or sit down and write fresh problems by hand (onerous).

I built something instead.

## What it does

- **Scrapes** the weekly lesson from my kid's curriculum portal (Python + Playwright, runs locally)
- **Classifies** each problem by mathematical concept using Sonnet 4.6 with JSON-schema output
- **Generates** new practice problems on demand (same concepts as the source, parent-tunable difficulty, parent-selectable focus tags) using Opus 4.6
- **Verifies** every generated problem with a second independent Opus pass that solves it and compares to the proposed answer
- **Renders** the result as a clean PDF (react-pdf), with a Next 16 UI for parent review and flagging
- **Traces** every LLM call to a local Phoenix instance, with a versioned golden dataset feeding the eval loop

## Decision Reasoning

Three decisions worth walking through:

### 1. Humans own the answer key

Treating AI-generated concept tags as ground truth would mean evaluating one AI against another AI's vocabulary, with no clean way to separate a model error from a label error. I ratify the taxonomy by hand before any eval runs against it.

### 2. Eval discipline from day one

Every LLM call traces to a local Phoenix instance via OpenInference semantic conventions. The golden dataset is on v3: text verification, label ratification, and primary-concept selection each earned their own version. v1 stays alive as a regression baseline; v2 and v3 layer in without invalidating earlier measurements.

### 3. Layered human-in-the-loop

Data quality issues need layered defenses, not one-off patches. LLM-as-judge scores every newly-ingested record for parseability, anything flagged goes to a human review queue, and human corrections refine the judge prompt over time. The pipeline starts at 100% human review and migrates toward ~5% as patterns get learned.

## Architecture

```
                     ┌─────────────────────┐
                     │  scrape lesson      │  Python + Playwright (local)
                     └──────────┬──────────┘
                                ↓
                     ┌─────────────────────┐
                     │  classify problems  │  Sonnet 4.6 + JSON schema
                     └──────────┬──────────┘
                                ↓
                     ┌─────────────────────┐
                     │  golden dataset     │  hand-ratified, versioned
                     │  (Phoenix)          │
                     └──────────┬──────────┘
                                ↓
                     ┌─────────────────────┐
                     │  generate worksheet │  Opus 4.6, concept selection from UI
                     └──────────┬──────────┘
                                ↓
                     ┌─────────────────────┐
                     │  verify each answer │  Opus 4.6 (independent solve)
                     └──────────┬──────────┘
                                ↓
                     ┌─────────────────────┐
                     │  parent UI + PDF    │  Next 16 (Turbopack), react-pdf
                     └─────────────────────┘
```

**Stack:** Next 16 · React 19 · TypeScript · Tailwind · base-ui · Drizzle ORM · Turso (libSQL) · Python 3.11 · Playwright · `arize-phoenix` (local) · `@anthropic-ai/sdk` · OpenInference instrumentation

## Setup

```bash
# Frontend
cd web
cp .env.example .env.local   # fill in TURSO + ANTHROPIC + MATHESIS_API_KEY
npm install
npm run dev                  # → http://localhost:3000

# Scraper + evals
cd scraper
cp .env.example .env         # fill in MATHESIS_API_URL + MATHESIS_API_KEY
uv sync
uv run python scrape.py discover   # interactive: log in, then dumps DOM
uv run python scrape.py scrape <assignment_id> --dry   # extract without writing

# Phoenix (local eval dashboard)
uvx arize-phoenix serve       # → http://localhost:6006
```

You'll need a Turso database (free tier), an Anthropic API key with Sonnet 4.6 and Opus 4.6 access, and credentials for the curriculum portal you're scraping. The scraper is currently shaped for one specific portal but the extraction logic in `scraper/src/extractor.py` is portable to other AngularJS-rendered math portals with minor changes.

## A note

This is a personal project, not a product. It exists because my kid needed practice problems. If parts of it are useful to you, fork freely.

---

Built by **Pooja Potnis**, PM exploring builder-track work. [LinkedIn](https://www.linkedin.com/in/pooja-potnis-31b9a2227/) · [poojakpotnis@gmail.com](mailto:poojakpotnis@gmail.com)
