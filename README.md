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

This repo is **a complete Shopify theme** — Shopify's
[Horizon](https://github.com/Shopify/horizon), the current flagship theme, with
the Kwadzilla coming-soon page and game built on top. So you can either:

- **[Upload the whole repo as a theme](#uploading-as-a-theme)**, or
- **[Copy the parts you want into a theme you already have](#installing-on-horizon)** —
  the Kwadzilla files are self-contained and drop into Horizon, Dawn, or
  anything else OS 2.0.

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

assets/kwadzilla-splash.js         the coming-soon page (WebGL)
assets/kwadzilla-splash.css        page styles + no-WebGL fallback
sections/kwadzilla-coming-soon.liquid   section wrapping the above
templates/password.json            the coming-soon page, wired up
templates/page.coming-soon.json    the same thing as an ordinary page

index.html                         the coming-soon page
game.html                          standalone game preview
```

Everything else — `layout/`, `config/`, `locales/`, `snippets/`, and the rest
of `sections/`, `blocks/`, `templates/` and `assets/` — is Horizon, and is
what makes the repo a theme rather than a pile of parts. See
[Credits](#credits).

`index.html` and `game.html` are plain-HTML local previews, not theme files.
They're listed in `.shopifyignore` so they never get pushed to a store.

## Uploading as a theme

With the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli):

```bash
shopify theme check
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

Once it's uploaded, both halves are already wired up.

**The coming-soon page** is the password template, so turning on
**Online Store → Preferences → Restrict access** is all it takes — visitors
get the lizard, and the *Enter using password* link still gets you in. To put
it on an ordinary URL instead, create a page in **Online Store → Pages** and
give it the **coming-soon** template.

**The game** goes on a page with the **kwadzilla-horizon** template (theme
blocks) or **kwadzilla** (all-in-one). Both ship with copy filled in.

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
| `Theme palette` | You want it to follow the theme's own page colours. |

On `None` and `Theme palette` the buttons borrow the surrounding text colour,
so they stay readable on a light background.

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

### The theme palette backdrop

`sections/kwadzilla-arcade.liquid` and the game block both offer a **Theme
palette** backdrop, which drops the arcade styling and takes the theme's own
page colours (`--color-background` and `--color-foreground`) instead. Use it
when the game should read as part of the page rather than as a panel dropped
onto it.

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
# http://localhost:8000/          the coming-soon page
# http://localhost:8000/game.html the game
```

To preview them the way a shopper would — inside the theme, with the header,
footer and theme settings — use `shopify theme dev` against a dev store
instead.

## The coming-soon page

While the game is in development, the coming-soon page is the front door and
the game lives at `game.html`. Nothing on the splash links to the game.

It is fire, filling the viewport. No image and no video: a flame front
raymarched in WebGL2 against a 3D noise volume built at load.

It is genuinely volumetric rather than a scrolling texture — rays march
through a slab of density, so near tongues occlude far ones, the fire has
depth to look into, and its light falls off through its own smoke. That is
what a flat fire shader cannot do, and it is most of why this reads as fire
rather than as an animation of fire.

- **The volume.** Computing noise in the shader is the obvious approach and
  the wrong one: a raymarch evaluates density tens of times per pixel, and
  each evaluation would want a couple of dozen hashes. A 48³ RGBA 3D texture
  turns each octave into one filtered fetch and lets the hardware interpolate.
  Three of its channels are used together as a warp vector, so the domain
  distortion costs a single fetch rather than three.
- **The shape.** A threshold that climbs with height, which is what turns a
  cloud into tongues that taper and break off. The sampling domain is squashed
  vertically, because isotropic noise makes smoke and fire is drawn upward by
  its own draft. Absorption is set high enough that the front of the fire hides
  what is behind it — too low and every tongue in the slab sums into one flat
  sheet of white.
- **Embers** ride the same wind, born bright and dying cool, drawn additively
  over the graded frame.

**It reacts to the visitor.** On a pointer the flames lean towards the cursor,
flare under it, and the whole front leans on a wind that follows which side of
the frame the cursor is on. On a touchscreen a drag does the same, a tap throws
an expanding burst of heat, and the phone's own roll pushes the front sideways
like wind on a torch — yielding to a finger the moment one lands, because a
deliberate touch should beat the hand's own wobble. Every force is smoothed:
fire has mass, and a pointer that jumps a hundred pixels between frames would
otherwise snap the whole front sideways.

Still zero dependencies and zero network requests. If WebGL2 is missing or
JavaScript is off, a banked ember glow takes over; the words are real DOM
either way, so screen readers and crawlers always get them.

`prefers-reduced-motion` slows the fire and the embers rather than stopping
them, because fire that does not move is not fire. The raymarch trades march
steps before it trades resolution — a volume degrades far more gracefully by
taking fewer samples than by going blocky — and the whole thing pauses when the
tab is hidden or the page scrolls away.

### The wordmark

Paste an `<svg>` into the section's **Wordmark SVG** setting, or into the
`[data-kwad-mark]` slot in `index.html`, and that is the entire swap: the
script spots the element, adds `.has-mark`, and the two text lines take
themselves out. Give the SVG a `viewBox` so it can scale, and
`fill="currentColor"` if it should take the page colour. It is given
`role="img"` and a label automatically if it has neither.

With the slot empty the text lines are used instead, and read from
`--kwad-font-display`: upload a `.woff2` to `assets/` and name it in the
section's **Typeface** setting. Those lines are split into per-character spans
carrying `--i` and `--n`, with `.is-ready` set on the first rendered frame —
a stagger handle and a start signal for whatever animation comes later. See the
*wordmark animation hooks* block at the bottom of `assets/kwadzilla-splash.css`.

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

The theme scaffolding is Shopify's [Horizon](https://github.com/Shopify/horizon)
(v4.1.3) — the flagship theme Shopify ships as the default — copied in
unmodified apart from the `theme_info` name and author, and the password
template, which now points at the coming-soon section. It's MIT-licensed; see
`LICENSE.md`, which covers that scaffolding rather than the game.

Note the licence limits use to themes that integrate with Shopify, which is
exactly what this is.

The game, the splash, and everything under the `kwadzilla-*` names are
original work.
