# Design system

VECTORA's interface follows Japanese minimalist principles: **kanso** (remove what is not needed), **ma** (space with intent), **shibui** (understated refinement) and a little **wabi-sabi** (material character without clutter). It should read like an editorial publication that happens to be a developer tool.

Tokens live in `apps/web/src/lib/tokens.ts` (used by the WebGL renderers) and are mirrored as CSS custom properties in `apps/web/src/styles.css`. A unit test keeps the two in step.

## Colour

### Light

| Token | Value | Use |
|---|---|---|
| Canvas | `#F8F7F2` | Page background |
| Washi (surface) | `#F3F1EA` | Panels, bands |
| Elevated | `#FBFAF6` | Inputs, dialogs |
| Sumi (text) | `#20211F` | Primary text |
| Secondary text | `#5F5D55` | Supporting text |
| Stone (muted) | `#8C897F` | Metadata |
| Ash | `#B8B3A7` | Quiet borders, external nodes |
| Line | `#DCD8CE` | Rules and borders |
| Indigo | `#34445C` | Accent, selection, active relationships |
| Clay | `#A18C72` | Second accent, derived relationships |

### Dark

| Token | Value |
|---|---|
| Canvas | `#171816` |
| Surface | `#20211F` |
| Elevated | `#272824` |
| Primary text | `#ECEAE2` |
| Secondary text | `#A7A499` |
| Muted text | `#77766D` |
| Border | `#373832` |
| Indigo accent | `#8292AD` |
| Clay accent | `#B39A7A` |

### Semantic

| Role | Light | Dark |
|---|---|---|
| Success | `#55704F` | `#8FAE8A` |
| Warning | `#7D5C1B` | `#C9A566` |
| Error | `#964436` | `#D08C7C` |
| Selection | Indigo | Indigo accent |
| Active relationship | Indigo | Indigo accent |
| Unverified relationship | Clay | Clay accent |

Contrast is tested: primary text reaches at least 7:1 on every surface, secondary text and all semantic colours at least 4.5:1, muted text at least 3:1 (it is used only for metadata).

Colour is never the only signal. Node types have glyphs, sizes and 3D shapes; derived relationships are dashed or thin and labelled; status messages begin with a word (“Error.”, “Note.”).

## Typography

| Role | Family | Use |
|---|---|---|
| Primary | Zen Kaku Gothic New (400, 500, 700) | Interface text |
| Editorial | Shippori Mincho (400, 600) | Page and section headings, the About text, the brand line |
| Technical | IBM Plex Mono (400, 500) | Paths, symbol names, code, counts, metadata |

The fonts are bundled (Latin subsets) through `@fontsource`; nothing is fetched from a font service.

| Level | Size | Family |
|---|---|---|
| Display | 44–64 px, fluid | Mincho |
| Page heading | 30–40 px, fluid | Mincho |
| Section heading | 20–24 px | Mincho |
| Body | 15 px, line-height 1.6 | Gothic |
| Label | 13 px | Gothic |
| Metadata | 12 px | Mono |

Rules: sentence case everywhere; no all-caps labels; body lines kept under about 68 characters; the only letter-spaced text is the wordmark. Not every heading is large — inside the workspace, headings are 18–24 px.

## Space and shape

- A 4 px base. Controls use 4–8 px gaps, components 12–20 px, sections 24–40 px, editorial pages 48–96 px.
- Layouts sit on a 12-column grid and are deliberately asymmetrical: headings start in the second column, body text in a narrower column further right.
- Borders are 1 px `Line`. Shadows are used only under dialogs and popovers.
- Corners are square or 2–3 px. There are no pill shapes.
- Surfaces are separated by rules and tone, not by cards. Lists are rows with a bottom rule.

## Signature element

The brand is set vertically along the left edge of the landing page (`writing-mode: vertical-rl`), a nod to Japanese vertical typesetting. It is the one decorative gesture; everything else stays quiet.

## Motion

| Use | Duration |
|---|---|
| Interface transitions (hover, focus, rows) | 200 ms |
| Panels and dialogs | 380 ms |
| Camera transitions | 600–820 ms, eased in and out |
| Layout settling | about 2.4 s (subtle) or 4.2 s (standard) |

No bounce, no pulsing, no looping decoration. The only ambient motion is the slow rotation of the landing illustration, which stops when it is off screen. With reduced motion (system setting or Settings) transitions are instant, camera moves jump, layouts are computed in one step and the illustration is still.

## Components

Defined as CSS classes in `styles.css` and small React wrappers in `components/ui.tsx`.

| Component | Notes |
|---|---|
| Button (`.btn`, `-primary`, `-quiet`, `-sm`, `-icon`) | 36 px high (28 px small). Primary is Sumi on Canvas and turns Indigo on hover. Pressed state uses `aria-pressed` |
| Field (`.field`) | Inputs, selects and text areas; focus is an Indigo border |
| Toggle, SelectField, NumberField | Label on the left with an optional hint, control on the right |
| Dialog | Radix dialog with overlay; title in Mincho |
| Tag (`.tag`, `.tag-derived`) | Small bordered label; the derived variant is dashed |
| Notice | Left rule in the semantic colour, starts with a status word |
| Link row (`.link-row`) | List row with a bottom rule; shifts 6 px on hover |
| Data table (`.data-table`) | Rules only, numeric columns right-aligned in mono |
| TypeMark | Glyph plus type name |
| Section heading | Mincho heading over a rule, optional note on the right |

## Accessibility

- Every page has one `h1`, one `main`, a skip link, and landmarks with names.
- All controls have accessible names; form fields have labels.
- Focus is always visible (2 px Indigo outline).
- Dialogs and the command palette trap focus and close with Escape.
- The graph canvas is keyboard operable; the Mind Map and Search offer the same content as focusable elements.
- These points are checked by the browser tests.

## Copy

Plain verbs, sentence case, no exclamation marks. Buttons say what happens (“Index this folder”, “Download and index”). Errors say what went wrong and what to do. Empty states say what will appear and how to make it appear. The product is described as a code intelligence, repository analysis and knowledge exploration platform.
