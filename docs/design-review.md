# flux against the data desk guidelines

an illustrated version, with the before and after screens and the kernel set
against the pdf specimens: https://claude.ai/artifact/ArJaWpETWu13gcpkj4QevB

review of 2026-10-09, against mikael dahlén's visual identity guidelines
(the 95-page pdf: 2022 identity and masters, 2026 cartography and ui), the
2× figma rasters embedded in its ui examples (pdf:88-93, measured with a
script), the appendix maplibre reference and the marking svgs. page numbers
are the pdf's (`pdf:n`); printed folios are five lower.

the review found flux close to the guidelines in structure and loose in
detail: the panels, key, card and markings were the right devices, but the
satellite imagery ignored the gradient map, the type had drifted (a
synthesised bold, a serif glyph, 8px and 14px text where the ui is 11px),
secondary grey had spread to every label, and most spacings were near the
tokens rather than on them. the cause was the earlier encoding: `map.css`
classes a page could override, and did.

## what changed

the guidelines are now code in the `design` repository, as a kernel, and
flux is built on it:

- `dd.js`: the ui chapter (pdf:77-86) as custom elements that draw their own
  chrome in shadow roots from the tokens (`dd-panel`, `dd-key`, `dd-row`,
  `dd-btn`, `dd-toggle`, `dd-dot`, `dd-slider`, `dd-label`, `dd-logo`), and
  the map furniture: the basemap, markings, the satellite gradient map
  applied per pixel, line styles, labels and hover labels, and a one-call
  map for notebooks. a page places an element and fills it; it cannot
  restyle it.
- `audit.js`: every rendered glyph and box, through shadow roots, and every
  layer a page adds, checked against the tokens. `make audit` runs it over
  the intro, the map and an open card, and fails on anything `AUDIT`
  (`web/layers.js`) does not declare.

the pre-change build had 22 undeclared findings by that check; it has none
now. the check proves values come from the allowed set, not that the right
value is in the right place: that is the elements' job, and the reason they
exist.

## fitting the drawings

a second pass rebuilt the guidelines' ui examples (pdf:88-91) word for word
and set them against the figma rasters the pdf embeds, band by band at 2×
(`test/fit.mjs` in the design repository). every edge now lands within
1.5px. getting there settled what the written spec leaves open:

- **leading.** every 2026 drawing sets ui text at inter's own line height,
  1.21 (intro lines 17px apart at 14px), not the 2022 prose rule's 1.4. that
  was the 21-versus-18px gap between statistic rows.
- **features.** the drawings use inter's defaults: proportional, standard
  digits. tnum, ss01 and ss02 (pdf:21) had made flux's numbers look
  monospaced. they stay with prose.
- **optical size.** the drawings were made at 2×, so inter's automatic optical
  size followed the doubled size: 22 at 11px, 26 at 14px. css's own (14) ran
  5% wide and heavy. with greyscale smoothing, as figma draws white on black,
  the weight matches.
- **tracking.** the intro heading's "-3%" is thousandths of an em: both
  drawings of it measure untracked within a pixel.
- **weight.** figma's raster softens stroke cores; at 400 the browser's are
  solid white and read heavier on black (39% more fully white pixels for the
  same footprint). regular is set at 370, which matches the drawing's solid
  ink within 1% on a light row and by eye on dark; at 32px it runs the other
  way, and the intro's bold is 750.
- **geometry the text omits**, measured: statistics 18px apart, directly under
  the heading rule; selectable rows 25px, 4px apart, 9.35px under their
  header; controls 22px; key markings top-aligned in 15px slots, 24.5px apart,
  13.5px padding top and bottom; the dot grid 7.5px between rows; the chart
  67.5px tall, five dim ticks spanning the data and the rule 13px under the
  lowest. data columns are set from their left edge, as wide as their widest
  value (the drawn table's sit 23 and 11px wide at the right).

five places the drawings disagree with the text, a ruling or each other are
named in the harness rather than fitted: one chevron on the key (twice),
uneven quarter columns, a 35px gap under the dot grid where every other gap
is 38, a tighter world-map frame on pdf:91, and one line break.

## findings

fixed unless marked. **declared**: a deliberate deviation written into
`AUDIT`. **open**: a question for mikael, or work not done here.

### imagery

1. **the satellite imagery ignored the gradient map** (pdf:62). it was
   desaturated under a brightness ceiling of 0.75, so desert and concrete
   rendered at 60-75% grey and the imagery outweighed the markings, the
   opposite of pdf:69 and 92. `dd.grade()` now maps luma to the fixed stops
   (L0, L13, L35, L75 at 0, 57, 90 and 100%), interpolating in L*. the
   highlight is L75 (`#B9B9B9`); a mid-grey roof lands near L13.
2. imagery under an open card dims to 35% of the graded image, where it was
   25% of the ungraded one.

### type

3. **bold was synthesised.** inter was vendored at weights 400-500, so the
   intro heading's bold (pdf:77) was faked by the browser. now 400-700, with
   italic for captions (pdf:22).
4. **the info button was a serif glyph**: an italic bold 7px "i" in a white
   circle, which read as a clock. now the 10 × 10 circled i (pdf:82), drawn.
5. chart year labels were 8px. all ui text is 11px (pdf:78); the chart now
   draws at its rendered width so 11 is 11.
6. the plume card set its numbers at 14px, the intro panel's body size, over
   grey captions. now information rows, as the flare card (pdf:84).
7. the intro heading's leading was 1.4; headings take 1.0667 (pdf:23).
8. **map text is montserrat** (declared): maplibre draws text from sdf
   glyphs and the basemap serves no inter. hover labels and map labels now
   go through `dd-label` (inter, title underlined, annotation below,
   pdf:72), so only cluster counts and licence names remain. licence names
   lost their halo and went 10 → 11px. open: inter glyph pbfs would close it.

### colour

9. **secondary grey had spread to every label**: key group labels, quarter
   and year labels, card statistic labels, table headers. the ui examples
   set all of these white (pdf:83-85); `#808080` is the intro panel's
   secondary text (pdf:77) and the rule colour, `#4D4D4D` the inactive
   state. labels are white again; grey is left for the intro's secondary
   lines, hints and the "beta" badge.
10. the intro sat over a 50% black scrim. the guidelines give a holding
    device a black ground and the map no veil; the other panels now hide
    while the intro is up, so it is the one device on screen.
11. **methane is on viridis** (declared, open). colour is meaning (pdf:66,
    71), but viridis is off both palettes. it is flux's deliberate choice,
    the ramp the plume rasters are rendered in. for mikael: approve viridis
    as the quantitative exception, or give a cartography ramp the rasters
    can share.
12. licence areas (private build) are a 7% fill under an 80% dashed line.
    an area is a solid outline with a dashed inset (pdf:68), and audit.js
    does not yet look at opacity in paint. open.

### spacing and geometry

measured against the 2× rasters, which put a panel at 270px:

13. panels were 250 and 290px wide; now 269 and 270, and the intro 459, as
    drawn (pdf:88-91).
14. the key's padding was 15 / 30 / 20 / 30 (right 30, bottom 20). it is l
    on the left, where the chevron hangs, and s elsewhere (pdf:90). its
    markings sat in a 13px column at 11px, 9px from the label; the specimen
    has a 15px column, markings at 0.8 of their svg size, the label 15px on.
15. the heading rule sat 3px under the text and the subtitle 8px under the
    rule; the specimen has about 2 and 3. the chevron now centres on the
    rule, as drawn.
16. selectable rows were 19px tall and 3px apart; the specimen's are 25px
    and 4px apart, bordered left and right (pdf:80, 89). statistic rows stay
    unbordered, 18px apart as drawn.
17. the quarter grid centred dots under their labels with space between;
    the specimen has four equal columns, each dot just in from its column's
    start, the years right.
18. buttons are 22px tall, as drawn (the enter button was 25).
19. the drawer used 12, 5, 8 and 20px paddings; now tokens.

### structure and behaviour

20. **the plume card's heading was a link** to the provider. a collapsible
    heading opens and shuts its card and is never a link (ruling
    2026-07-08); the link is now the card's source row.
21. hover popups were maplibre popups with their own markup. they are now
    `dd-label`s on the marking, up and right of it (pdf:73), not at the
    pointer.
22. **the highlight box frames the marking itself** (open). the guidelines
    put the box round the point of interest and move its marking to the
    box's top-right corner, with the label beside it (pdf:68-69, 74). the
    red glow under an open flare (the heat footprint) has no counterpart in
    the guidelines; it is data, declared.
23. the key has one chevron, on the first group (ruling 2026-07-08). the
    pdf draws one per group (pdf:90). kept; for mikael.
24. an open key has 20px under its last row where the drawing has 13.5,
    which read tight on screen, most under the methane group with a row
    more than its neighbours (ruling 2026-10-09).
25. a contracted panel keeps its padding (ruling 2026-07-08); the pdf drops
    it to s except on the left (pdf:88-89). kept.
26. the detail card led with coordinates and "also here", then the
    statistics a section gap down; the specimen sets the statistics directly
    under the rule (pdf:89). they are there now, the coordinates first; the
    "also here" row that followed them went (2026-10-09), and a heading too
    long for its line ends in an ellipsis rather than wrapping. the chart takes the drawn form: small
    dots, ticks up the left, a rule along the foot.
27. the /review page still uses `map.css` classes (open).

## in the running app

set against the screens rather than the specimens (2026-10-09): the drawer's
tabs had lost their padding and grey, because a page's own rules (flux's
`* { padding: 0 }` reset, `button { color: inherit }`) beat a shadow root's
`::slotted` ones. the kernel now marks slotted chrome important, and the
specimen carries that reset so the fit test would catch it. the drawer's
outer columns come in to its head's padding, so tabs, rows and count share
an edge; the intro's region text keeps its lines on a phone and the map
gives way; the plume analysis spaces its lines as the card's sections.

## for notebooks

the notebook survey found 27 maplibre maps across 20 notebooks, four of
them on the dark basemap, none on the markings module, each carrying 50-80
lines of the same setup: loading, popup css, inline marking svgs, an icon
helper, a greyscale imagery layer, a hover loop, a hand-built legend. text
ran from 11 to 13px in three typefaces; colour encoded category in most.
`dd.map()`, `dd.hover()`, `dd.label()` and `<dd-key>` replace that, and the
audit tells a notebook what is left. the `data-desk-design` skill now says
so.
