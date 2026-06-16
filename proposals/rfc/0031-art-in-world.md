# RFC-0031: Art in the World — paintings as image prompts, cards as ahref text prompts

- Status: Accepted (verbal sign-off from ABK; build alongside)
- Author: peppers contributor
- Date: 2026-06-15
- Depends on: gram items layer + `look`/`inspect` (RFC-0013/020), ghost cognition pipeline (RFC-0025 substrate)
- Related: [[project_cultural_memory_graveyard]] (emergent culture), RFC-0029 (gram-native props precedent)

## Summary

Decorate the world with works of art hung on the walls. Each artwork is a **literal
image**: if a ghost chooses to look at it, the image itself is fed into its cognition
as a prompt — no system narration, no "appreciate this," just a painting on a wall.
Beside each painting hangs a **description card**, which is an `href` to the work's
museum object page. If the ghost chooses to read the card, the page text is fed into
its cognition as a prompt. The ghost decides whether to engage and *how* — look,
read, or walk past.

The payoff is emergent culture: ghosts form their own tastes and references from
unmediated exposure, argue about works, and carry an aesthetic memory into their last
words. Nothing is prescribed; the art is pure opportunity.

## Motivation

Today a ghost's only inputs are text — world perception, peer speech, its own needs.
It has never *seen* anything. Hanging real art (and real curatorial text) in the world
gives ghosts a genuinely new class of stimulus and a characterful choice in how to
meet it: the aesthete lingers on the image, the scholar reads the placard, the
philistine moves on. This is free will expressed against opportunity, and it feeds the
cultural-memory roadmap with material the ghosts actually chose to absorb.

## Decisions (from the brief)

1. **Curation** — a smattering, in linear chronological "museum hang" order: medieval
   and Titian-era through to modern. **2D media only** (paintings, drawings, prints) —
   no photographs of 3D objects, because a flat image is the same thing the ghost sees
   that we do; a photo of a sculpture is not the sculpture.
2. **Card target** — the museum's **own object page** (Met / NGA), not Wikipedia.
   Guaranteed 1:1 with the work and richer/curated.
3. **Full pipeline insert** — the artifact rides the **normal cascade**. The Id sees it,
   the Surface responds to it, the memory pipeline runs. No separate "contemplation"
   architecture.
4. **Model** — the encounter cascade routes to the **smallest cheapest vision-capable
   model**. Default `PEPPERS_VISION_MODEL=openai/gpt-5-nano` (OpenRouter; in $0.05/M,
   vision, OpenAI family); env-overridable (model authority stays with the operator).
5. **The ahref function** — ABK-requested: cards are real hyperlinks and there is a
   first-class function to dereference one into prompt content.

## Sources

- **Met Open Access** — `collectionapi.metmuseum.org`; CC0 metadata, `isPublicDomain`,
  `primaryImage(Small)`, `objectURL`, `classification`, `objectBeginDate`. Verified
  reachable.
- **NGA opendata** — `github.com/NationalGalleryOfArt/opendata` (published_images.csv +
  objects); public-domain images via IIIF. Verified reachable.

Both expose the four fields curation needs: a 2D `classification`, a public-domain
image URL, an object-page URL, and a date to sort by.

## Design — compose, don't invent

### Placement (gram-native, like vendors)

Two new item types declared in the Moscone gram:

```
(artwork:ItemType:Artwork  { name: "Painting",        glyph: "🖼", takeable: false, capacityCost: 0 })
(artcard:ItemType:ArtCard  { name: "Description card", glyph: "🪧", takeable: false, capacityCost: 0 })
```

An items layer places an `Artwork` on a wall cell and an `ArtCard` on the adjacent
cell, in chronological order along a gallery walk. The gram only authors *where*
(same limitation as vendors — the `ItemType` parser carries no arbitrary attrs), so the
per-work data lives in a **registry** seeded at startup.

### Registry (like `vendors.ts`)

`artworks.ts`: `registerArtwork({ cell, cardCell, imageUrl, objectUrl, title, artist, date })`,
keyed by cell. Seeded in `server/src/index.ts` from a curated catalog
`maps/moscone/moscone-west-aiewf.artworks.json` (cell → metadata). The curation script
emits the gram items layer *and* this catalog from one pass, so they never drift.

### Perception & the two dereference verbs

- `look` surfaces art on/around the tile minimally — "A painting hangs here." / "A
  description card is beside it." — with no framing. (An `artObjectsForAt`, mirroring
  `vendorObjectsForAt`; the raw `Artwork`/`ArtCard` items are skipped from
  `tileItemsForAt` to avoid duplication.)
- **`inspect` an `Artwork`** → returns `{ kind: "artwork", imageUrl, title?, … }`. The
  image is the payload.
- **`read` (the ahref function)** an `ArtCard` → server resolves the card's `href`
  (its object-page URL), fetches it once and **caches** it, returns
  `{ kind: "page", url, text }`. The ghost reads a card it perceives; it does not pass
  an arbitrary URL (see Security).

### Full-pipeline insert (peppers boil)

`inspect`/`read` outcomes that carry an image or page text are stashed as a
**`pendingPerception`** for the next cascade (same pattern as `pendingEffects`). On the
next cascade:

- the **image** is injected as a multimodal `input_image` part into the Id and Surface
  inputs (Responses-API content array), and that cascade is **routed to the vision
  model**;
- the **page text** is injected as ordinary `input_text`.

Because it rides the normal cascade, the Surface responds, the cascade record is
written, and the memory/consolidation pipeline runs over it unchanged — "the whole
shebang, no separate architecture."

### Router

A `vision` tier added to peppers-router (`PEPPERS_VISION_MODEL`, default
`openai/gpt-5-nano`). Used only for a cascade that carries an image; text-only cascades
stay on the bulk/quality route, so cost is unchanged except when a ghost actually looks.

## Security / safety

The `read` function feeds external web content into a prompt. To keep it
deterministic and safe:

- A ghost dereferences a **card it perceives**, not a free-form URL — the href is the
  curated object-page URL from the registry.
- Fetches are **server-side, cached, and domain-allowlisted** (`metmuseum.org`,
  `nga.gov`). No arbitrary egress, no live failure mid-run after first fetch.
- Page text is **sanitized to text** (no scripts/markup) and length-capped before it
  enters a prompt.

## Boil split

- **World substrate (ABK domain, blessed):** item types in gram, `artworks.ts`
  registry + startup seed, `look` perception, `inspect`→image, `read`→cached page,
  errors + IC-003 allow-list + agent-card `requiredTools`.
- **Peppers boil:** `pendingPerception` threading, multimodal image-part injection,
  vision-model routing.
- **Build tooling:** curation script (Met/NGA → catalog + gram layer).

## Build plan

1. Curation script → `artworks.json` catalog + gram items layer (2D-only, chronological).
2. Substrate: item types, registry, perception, `inspect`→image, `read`(ahref)→cached
   page, errors, allow-list, card requiredTools.
3. Cognition: `pendingPerception`, image-part injection (Id + Surface), vision routing.
4. Place into the Moscone gram (gallery walk) + verify parse.
5. Verify live: a ghost looks → image enters cognition → reacts; reads card → page text
   enters → reacts; the cascade/memory pipeline runs.

## Open knobs

- Exact vision model slug (operator sets `PEPPERS_VISION_MODEL`; default is a grounded
  cheapest-tier pick, not a mandate).
- Smattering size and the chronological route's cells (ABK blesses final placement).
- Whether `read` later generalizes to any allow-listed href beyond art cards (ABK's
  ahref primitive could serve future signage); out of scope here, designed not to
  preclude it.
