# Kwadzilla — The Biggest Lizard Breaks Out

A playable Shopify splash page. It's a *Rampage*-style arcade game: a giant
lizard comes ashore on an island built entirely out of prisons, climbs the
walls, pulls the buildings apart floor by floor, and gets everybody out.

Break a barred window and somebody walks free. The score that counts is the one
marked **FREED**.

Zero dependencies, zero network requests, one canvas. All art is drawn in code
(including the 5×7 bitmap font), all sound is synthesised with WebAudio, so
there are no images, fonts, or audio files to host.

---

## Two ways to use this

This repo is **a complete Shopify theme** — Shopify's [Skeleton
theme](https://github.com/Shopify/skeleton-theme) with the Kwadzilla game built
on top. So you can either:

- **[Upload the whole repo as a theme](#uploading-as-a-theme)**, or
- **[Copy the game into a theme you already have](#installing-on-horizon)** —
  the game files are self-contained and drop into Horizon, Dawn, or anything
  else OS 2.0.

## Files

The game's own files, which are the ones to copy if you're taking the
drop-in route:

```
assets/kwadzilla-game.js           the whole game (~87 KB unminified)
assets/kwadzilla-game.css          splash page + arcade cabinet styles

blocks/kwadzilla-game.liquid       theme block — Horizon & other block themes
sections/kwadzilla-arcade.liquid   theme-block section to compose it in
templates/page.kwadzilla-horizon.json   page template for the above

sections/kwadzilla-game.liquid     all-in-one section — Dawn & older OS 2.0
templates/page.kwadzilla.json      page template for the above

assets/kwadzilla-splash.js         the coming-soon splash (WebGL)
assets/kwadzilla-splash.css        splash styles + no-WebGL fallback

index.html                         the coming-soon splash
game.html                          standalone game preview
```

Everything else — `layout/`, `config/`, `locales/`, `snippets/`, and the rest
of `sections/`, `blocks/`, `templates/` and `assets/` — is Skeleton, and is
what makes the repo a theme rather than a pile of parts. See
[Credits](#credits).

`index.html` and `game.html` are plain-HTML local previews, not theme files.
They're listed in `.shopifyignore` so they never get pushed to a store.

## Uploading as a theme

With the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli):

```bash
shopify theme check      # 44 files, no offenses
shopify theme dev        # preview against a dev store
shopify theme push -u    # push as an unpublished theme
```

Or upload it through the admin without the CLI — zip the repo and use
**Online Store → Themes → Add theme → Upload zip file**:

```bash
git archive --format=zip -o kwadzilla-theme.zip HEAD
```

The theme's name and author live in `config/settings_schema.json` under
`theme_info` — currently both `Kwadzilla`. Change them before you ship if you
want something else in the admin.

Once it's uploaded, the game is already wired up: create a page in **Online
Store → Pages** and give it the **kwadzilla-horizon** template (theme blocks)
or **kwadzilla** (all-in-one). Both ship with copy filled in.

## Installing on Horizon

Horizon is built on [theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks),
so the game ships as one, and slots in anywhere Horizon accepts blocks.

1. Copy `assets/kwadzilla-game.js` and `assets/kwadzilla-game.css` into
   `assets/`.
2. Copy `blocks/kwadzilla-game.liquid` into `blocks/`.
3. In the theme editor, **Add block → Kwadzilla game** — inside any section
   that takes theme blocks. Use Horizon's own heading and text blocks around it
   for the copy.

Optionally also copy `sections/kwadzilla-arcade.liquid` into `sections/` for a
ready-made arcade-night canvas that accepts any theme or app block, and
`templates/page.kwadzilla-horizon.json` into `templates/` for a whole page
wired up already (**Online Store → Pages**, template **kwadzilla-horizon**).

The block's **Backdrop** setting decides how it meets the page:

| Backdrop | Use when |
| --- | --- |
| `None` | The surrounding section already has the look you want. |
| `Arcade night` | You want the cabinet as a self-contained dark panel. |
| `Theme colour scheme` | You want it to follow one of the theme's schemes. |

On `None` and `Theme colour scheme` the buttons borrow the surrounding text
colour, so they stay readable on a light scheme.

You can place more than one on a page; each instance runs independently.

## Dawn and older OS 2.0 themes

Themes without theme blocks use the all-in-one section instead, which carries
the headline, copy, feature grid and footnote itself.

1. Copy the two files in `assets/` as above.
2. Copy `sections/kwadzilla-game.liquid` into `sections/`.
3. Either:
   - **Page template** — copy `templates/page.kwadzilla.json` into `templates/`,
     create a page in **Online Store → Pages**, and pick the **kwadzilla**
     template; or
   - **Any page** — in the theme editor, **Add section → Kwadzilla game**.

## Either way

Push it with `shopify theme push`, as in [Uploading as a
theme](#uploading-as-a-theme).

### The colour scheme backdrop

`sections/kwadzilla-arcade.liquid` has a **Theme colour scheme** backdrop that
reads the theme's own schemes. Skeleton ships without any, so this repo adds a
`color_scheme_group` to `config/settings_schema.json` and emits a
`.color-{scheme}` class per scheme from `snippets/css-variables.liquid`. Two
schemes are defined out of the box — `scheme-1` light, `scheme-2` arcade dark.

If you're dropping the game into Horizon or Dawn instead, they already define
their own schemes and you don't need any of this.

### Settings

Everything is editable in the theme editor without touching code. The block
exposes layout, buttons, reward, accent colours and sound; the all-in-one
section adds eyebrow, heading, subheading, intro copy, the footnote, and up to
six "feature" blocks.

**Reward:** set a discount code and a score threshold. Clear the threshold and
the game-over screen reveals the code with a copy button; miss it and it shows
the target instead. Leave the code blank to turn the reward off entirely.

> Create the discount itself in **Discounts** first — the game only reveals a
> code, it doesn't create one.

**Sound:** off until the visitor interacts with the page (browser autoplay
rules), and the toggle is remembered in `localStorage`.

## Local preview

The splash and the game are plain HTML, so they need no Shopify tooling:

```bash
python3 -m http.server 8000
# http://localhost:8000/          the coming-soon splash
# http://localhost:8000/game.html the game
```

To preview them the way a shopper would — inside the theme, with the header,
footer and theme settings — use `shopify theme dev` against a dev store
instead.

## The coming-soon splash

While the game is in development, `index.html` is a full-screen teaser and the
game lives at `game.html`. Nothing on the splash links to the game.

It's one WebGL fullscreen triangle running a single fragment shader:

- **Procedural monitor-lizard hide.** Voronoi bead field with per-scale
  roughness, analytic normals, two-depth parallax and ocellus rosettes. The key
  light rides the cursor, so the whole surface shimmers as you move.
- **Two eyes, dead centre.** Analytic spheres with corneal refraction into the
  iris plane, procedural iris fibres, a round pupil (monitor lizards have round
  pupils, not slits), a limbal ring, and a wet catchlight that tracks the light.
  They track the cursor with real saccades — hold, then jump — plus
  micro-saccades, idle wander and blinks.
- **A red smoke wordmark.** The letterforms are hand-authored vector skeletons
  with per-point width (`GLYPHS` in `kwadzilla-splash.js`), rasterised once into
  an offscreen canvas that packs coverage, halo and dilation into R, G and B.
  The shader then domain-warps that texture into drifting smoke and bleeds red
  light back onto the beads underneath.

On mobile the eyes follow touch immediately. iOS gates the gyroscope behind a
permission call that only works inside a user gesture, so a small **Tap to let
it watch you** button appears there; on Android tilt is wired up straight away.
The grant is remembered in `localStorage`.

Still zero dependencies and zero network requests — no fonts, no images, no
libraries. If WebGL is missing or JavaScript is off, a pure-CSS lizard with
cursor-tracking eyes and a glowing wordmark takes over; the words are real DOM
either way, so screen readers and crawlers always get them.

`prefers-reduced-motion` freezes the smoke, blinks and idle drift but keeps the
cursor-driven light, parallax and gaze, since those are direct responses to the
visitor's own input. Render scale drops automatically if frames get expensive,
and a lost WebGL context is recovered rather than left as a black page.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `←` `→` / `A` `D` | D-pad |
| Climb up / down | `↑` `↓` / `W` `S` | D-pad |
| Smash | `Space` / `J` | SMASH |
| Jump | `Z` / `X` | JUMP |
| Rage | `Shift` / `K` | RAGE |
| Pause | `Esc` / `P` | ⏸ button |

Fill the RAGE meter by smashing. Cashing it in gives a few seconds of
invulnerability, and holding smash during it breathes fire.

**Getting around.** Jump height is variable — tap for a hop (~22px), hold for a
full jump (~67px). A second jump in mid-air takes you to ~120px, two and a half
times Kwadzilla's own height. Jumping while clinging to a wall kicks off it
sideways with height to spare, and you keep a mid-air jump afterwards, so you
can chain kicks between two facilities to gain altitude fast.

## How the demolition works

Each facility is a grid of 8×8 destructible cells. A punch clears cells inside
a radius; when a floor drops below about a third of its structure it gives way
and everything above it settles down one row, so the building visibly sinks as
you gut it. Once ~60% of the structure is gone the rest can't hold itself up and
the whole thing comes down.

Cells flagged as lit windows hold someone. Destroying one releases them; they
drop to the street, cheer, and run for the shoreline. They're only counted once
they're clear of the island.

Buildings render into their own offscreen canvas and only re-render when
damaged, which is what keeps a few thousand cells at a steady 60 fps.

## What's shooting at you

Riot vans, helicopters, rooftop turrets, jets, and a gunship mini-boss that
shows up once you've flattened half a sector.

Helicopters telegraph every shot: the belly light blinks red and a dotted tracer
paints the target for about half a second before they fire, so a shot is always
something you can walk out of. They hold station well above head height rather
than parking on top of you, leave roughly four seconds between attacks, and go
down in two punches.

Measured with helicopters as the only threat and a stationary player who never
dodges, that's 25% less incoming damage per minute than before — and a player
who actually uses the telegraph gets far more than that.

## Hooks for analytics

The mount element dispatches bubbling events:

```js
document.addEventListener('kwadzilla:gameover', function (e) {
  // e.detail => { score, freed, level, best }
});
// also: kwadzilla:start { level }, kwadzilla:levelclear { level, score, freed, bonus }
```

And exposes read-only state:

```js
document.querySelector('[data-kwadzilla]').__kwad.getState();
// { phase, score, best, lives, level, freed, standing, hp, x, y, mode }
```

## Accessibility and performance

- Real focusable buttons and links for every menu; the canvas is keyboard
  operable and only captures keys while focused, so it never eats page scroll.
- `prefers-reduced-motion` cuts screen shake, particle counts and the scanline
  overlay.
- Pauses itself when the tab is hidden or the game scrolls out of view
  (`IntersectionObserver`), so it isn't burning CPU further down a long page.
- Fixed 60 Hz timestep with a frame-time cap, independent of display refresh
  rate.
- 480×270 backing store scaled with `image-rendering: pixelated` — the canvas
  cost is the same on a phone as on a 5K display.

## A note on the setting

Kwadzilla is arcade fiction. Every facility, tower, sign and logo in the game
was invented for the game — no real place, company or person is depicted.

## Credits

The theme scaffolding is Shopify's [Skeleton
theme](https://github.com/Shopify/skeleton-theme) — the reference theme
Shopify publishes as a starting point — copied in unmodified apart from the
colour-scheme group described [above](#the-colour-scheme-backdrop) and the
`theme_info` name and author. It's MIT-licensed; see `LICENSE.md`, which
covers that scaffolding rather than the game.

Note the licence limits use to themes that integrate with Shopify, which is
exactly what this is.

The game, the splash, and everything under the `kwadzilla-*` names are
original work.
