# Case Prep

A study page for case interviews: study guides plus spaced-repetition flashcards. Static files only (no build step, no server, no third-party scripts). The page is `case-prep.html` at the site root, and everything else lives in this folder.

```
case-prep.html            the page (site header/footer + app shell)
case-prep/
  case-prep.css           styles, including dark mode
  js/app.js               views, sessions, search, editor, import/export
  js/md.js                Markdown renderer, deck parser, CSV parser
  js/srs.js               spaced-repetition scheduler
  js/store.js             browser storage (localStorage)
  content/manifest.json   categories + list of deck files
  content/decks/*.md      one file per deck
  content/guides/*.md     optional long-form study guides
  tests.html              unit tests (open in the browser)
```

## Run locally

Browsers block `fetch()` from `file://`, so serve the repo root:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/case-prep.html, and http://localhost:8000/case-prep/tests.html for the tests.

## Add a deck

1. Create `content/decks/<deck-id>.md`:

   ```markdown
   ---
   title: Healthcare
   category: industries          # frameworks | brainstorming | industries | math
   guide: guides/healthcare.md   # optional
   description: One line shown on the deck page.
   ---

   ## Q: What is payer mix?
   @tags metric
   Share of revenue by payer: **commercial**, Medicare, Medicaid, self-pay.

   ## Q: A health system wants to enter outpatient surgery. Structure it.
   @mode recall
   1. Market ...
   ```

2. Add `"decks/<deck-id>.md"` to `content/manifest.json` (this sets the order on the home page).
3. Optional: add `content/guides/<deck-id>.md`. Its `##` and `###` headings become the table of contents.

No code changes are needed.

### Card format

- Every card starts with a `## Q:` line. The rest of that line is the front.
- Optional lines right under it: `@tags a, b`, `@mode recall` (type your structure before revealing), `@id some-id`.
- Everything after that, until the next `## Q:`, is the back (Markdown: lists, tables, bold, inline code).
- Card ids come from the deck id plus the front text. **Changing a card's front changes its id and resets its review history** unless you pin it with `@id <old-id>`. "Download deck as Markdown" adds the `@id` line for you when needed.

## Edits made in the browser

Each deck page has **Edit this deck**: rename the deck, add cards, or tick cards (shift-click for a range) and delete them in bulk. Cards added, edited, deleted or imported on the page, and deck renames, are saved in the browser (localStorage), not in these files. To make them permanent: Manage cards → Download deck as Markdown, replace the file in `content/decks/`, commit and push.

## Backups and moving devices

Progress lives in each browser. Manage cards → Export backup (JSON) saves progress, streak, flags and in-browser edits. Import it on the other device. Importing replaces that browser's progress.

## Scheduling rules

| Rating | New / learning card | Review card (interval I, ease E) |
|---|---|---|
| Again (1) | back in ~3 cards | back in ~3 cards, ease −0.20 |
| Hard (2) | back at end of session | max(I+1, I×1.2), ease −0.15 |
| Good (3) | 1 day | max(I+2, I×E) |
| Easy (4) | 4 days | max(I+3, I×E×1.3), ease +0.15 |

Ease starts at 2.5 and never drops below 1.3. Intervals cap at 365 days. A card is mature at 21+ days. New cards are limited per day (default 20, change it under Manage cards).

## Keyboard

Space = flip · 1–4 = rate · F = flag · E = edit · Esc = end session · Ctrl+Enter = reveal in recall mode · / = search

## Hosting note

The repo root has an empty `.nojekyll` file. Without it, GitHub Pages runs Jekyll, which turns the deck and guide `.md` files into HTML pages, so the raw files the app fetches return 404. Keep that file.
