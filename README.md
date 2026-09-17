# ianwpedersen.com

Personal site, hosted on GitHub Pages.

## Editing

Edit `index.html` (content) and `style.css` (styling), then commit and push to `main` — GitHub Pages redeploys automatically within a minute or two.

## First-time setup

1. Push this repo to GitHub as `ian-pedersen/ian-pedersen.github.io`.
2. In the repo's **Settings → Pages**, set the source to the `main` branch, root folder. Add `ianwpedersen.com` as the custom domain (the `CNAME` file already does this too) and enable **Enforce HTTPS** once it's available.
3. At your domain registrar, point DNS at GitHub Pages:
   - Four `A` records for the apex domain (`ianwpedersen.com`) to:
     - 185.199.108.153
     - 185.199.109.153
     - 185.199.110.153
     - 185.199.111.153
   - A `CNAME` record for `www` pointing to `ian-pedersen.github.io`.
4. DNS can take anywhere from a few minutes to 24 hours to propagate.
