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
viewer links need the viewer beside the page, so they lead nowhere locally; for the whole site,
build the world and the viewer, then `npm run build:site` and serve `dist/public`.

## Publishing

CI publishes the site to Cloudflare Pages, project `worldmodelzero`, once a push's tests pass
(the `deploy` job in `.github/workflows/ci.yml`): `master` to production, any other branch of
this repository to a preview at `<branch>.worldmodelzero.pages.dev`. `_headers` sets the
caching: a build's files never change, so they are cached for a year; the index naming the
latest build is not cached.

Setting it up, once, in Cloudflare and GitHub:

1. **The domain on Cloudflare.** If worldmodelzero.com was bought from Cloudflare Registrar it
   is already a zone in the account. If not, add it as a site (Websites → Add a domain, Free
   plan) and set the nameservers Cloudflare gives at the registrar.
2. **An API token.** My Profile → API Tokens → Create Token → Custom token, with the account
   permission *Cloudflare Pages: Edit*. Note the account ID too (on the account's home page).
3. **The secrets.** In GitHub, Settings → Secrets and variables → Actions: add
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without them the deploy job says so and
   publishes nothing.
4. **The first deployment.** Push to `master` (or re-run CI on it). The job creates the Pages
   project the first time.
5. **The domain on the project.** Workers & Pages → worldmodelzero → Custom domains: add
   `worldmodelzero.com`, and `www.worldmodelzero.com` if wanted (a redirect rule can send it to
   the bare domain). Cloudflare adds the DNS records and the certificate.
