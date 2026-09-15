# Deploying Anomaly Gallery

Static site, no build, no backend. The pages fetch paintings from Wikimedia
Commons and MediaPipe from jsDelivr at runtime, so your origin serves only
~60 KB of HTML.

## Repo layout

```
.
├── index.html               # landing page linking the three
├── anomaly-gallery.html     # the timed 5-painting game
├── ops-lab.html             # clone + removal ops, with timings
├── eye-graft.html           # eye harvest + graft, with live sliders
├── fetch-assets.mjs         # downloads paintings -> assets/
├── curate.html              # analyses them, writes assets/manifest.json
├── assets/                  # created by fetch-assets.mjs
├── CNAME                    # one line: yourdomain.com
└── .github/workflows/deploy.yml
```

Everything sits flat at the repo root — both tools resolve `assets/` relative to
where they run, so no `tools/` subdirectory is needed.

`CNAME` must contain exactly one line with the bare domain, no scheme, no
trailing slash:

```
yourdomain.com
```

Setting the domain in **Settings → Pages → Custom domain** writes this file for
you. If you also commit it by hand, keep the two in sync or Pages will fight you.

---

## 1. Push

```bash
git init
git add .
git commit -m "Anomaly Gallery"
git branch -M main
git remote add origin git@github.com:vikvic/anomaly-gallery.git
git push -u origin main
```

## 2. Turn on Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Not "Deploy from a branch" — the workflow in this repo uses the Actions path,
which is what lets you add a build step later without rewiring anything.

The first deploy lands at `https://vikvic.github.io/anomaly-gallery/`.

## 3. Point Route 53 at it

In your existing hosted zone, two records.

**Apex** (`yourdomain.com`) — record type **A**, one record, four values:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optionally the same as **AAAA** for IPv6:

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

**www** (`www.yourdomain.com`) — record type **CNAME**, value:

```
vikvic.github.io
```

Note the trailing dot Route 53 adds; that's fine. Do **not** use an ALIAS record
here — Route 53 ALIAS only targets AWS resources, which is exactly why plain A
records are the route for GitHub Pages.

## 4. HTTPS

Back in **Settings → Pages**, wait for the domain check to go green, then tick
**Enforce HTTPS**. GitHub provisions and renews a Let's Encrypt certificate
automatically. DNS propagation is usually minutes; the cert can take up to an
hour after that. If "Enforce HTTPS" is greyed out, the DNS check hasn't passed
yet — re-check the records rather than waiting indefinitely.

---

## What the workflow does

`deploy.yml` runs on every push to `main`:

1. Checks the four expected HTML files exist
2. Checks every local `.html` link in every page resolves to a real file
3. Uploads the repo as a Pages artifact and deploys it

Both checks are cheap and catch the failure that actually happens on a static
site — a renamed file leaving a dead link in the menu. `workflow_dispatch` gives
you a manual **Run workflow** button.

When you add a real build (minification, bundling, vendored images), uncomment
the Node steps and change `path: .` to `path: ./dist`.

---

## Known issue to fix before any real traffic

The pages call the Wikimedia Commons API from the browser on every load.
**Commons rate-limits this**, and it was hit repeatedly during development —
you get an HTML error page instead of JSON and the gallery fails to build.

For anything beyond a demo, vendor the images:

1. Download the ~13 paintings once (they're public domain — Commons, CC0 or PD)
2. Commit them to `assets/` as WebP at ~1000px wide (roughly 15–20 MB total)
3. Replace the `resolveAll()` API call with a static manifest

That also removes the CORS dependency entirely and makes first paint much
faster. If the asset set grows past what's comfortable in git, that's the point
at which an S3 bucket for `assets/` starts to earn its keep — the HTML can stay
on Pages.
