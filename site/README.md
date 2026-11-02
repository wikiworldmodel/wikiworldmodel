# The landing page

The public site's front page: a still from the viewer with a way into it, what the world holds,
and how to contribute. It is plain HTML, CSS and a few lines of script, with no build step.

On the site (see [docs/PUBLIC-PROJECT.md](../docs/PUBLIC-PROJECT.md), section 7) it is served at
`/`, with the viewer (`dist/site`, from `npm run build:viewer`) at `/world/` and the builds
beside it at `/world/builds/`. Its links into the viewer are relative, so they work wherever the
two are served together.

- `index.html`: the page. Its numbers are copied from the world: the counts from
  `npm run validate`, the time scale from the eon and era records in
  `world/entities/periods/ics/`, and the views' times and places from the golden tests. Update
  them when the world moves.
- `main.js`: copies the starter prompt, and works out how wide Rome would be on the time scale
  at the width it is drawn.
- `img/`: stills from the viewer's golden images (`viewer/test/golden/`), as JPEG. They are
  1280 pixels wide; for the launch the hero should be rendered again at twice that.
- `fonts/`: Newsreader and IBM Plex, Latin subsets from Fontsource 5.3.0, under the SIL Open
  Font License (the `OFL-*.txt` files beside them). They are served from the site, not from a
  font service, so the page makes no third-party requests.

To look at it locally: `python3 -m http.server -d site`, then open http://localhost:8000/. The
viewer links need the viewer beside the page, so they lead nowhere locally.
