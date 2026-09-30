# TEFAS Fund Screener

A static site on GitHub Pages that lists TEFAS securities investment funds
(Menkul Kıymet Yatırım Fonları, `fundType=YAT`) that pass a set of return
criteria. A GitHub Actions workflow refreshes the data every day at about
11:00 Istanbul time (08:00 UTC).

## Criteria

A fund is shown only if it breaks none of these rules:

1. The 1-month return is missing or below 3%.
2. The 3-month return is below 9% (a missing 3-month return is allowed).
3. The 6-month return is below 19% (missing is allowed).
4. The 1-year return is below 42.5% (missing is allowed).
5. A longer horizon has a lower return than a shorter one, for any pair among
   1M, 3M, 6M, 1Y, 3Y and 5Y where both returns exist (e.g. 3Y below 1Y).
   Year-to-date is not part of this check because its length changes through
   the year.

The rules live in [`site/filter.js`](site/filter.js) and run in the browser, so
the page can also list excluded funds with the rule each one broke.

## How it works

- [`scripts/fetch_funds.py`](scripts/fetch_funds.py) calls the JSON API behind
  [TEFAS › Fon Getirileri](https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT)
  with the page's default settings (funds traded on TEFAS only) and writes
  [`site/data/funds.json`](site/data/funds.json). It uses only the Python
  standard library and refuses to overwrite the file if the response looks
  wrong.
- [`.github/workflows/update.yml`](.github/workflows/update.yml) runs the
  script on schedule, commits the new data file (giving a daily history), and
  deploys `site/` to GitHub Pages. Pushes to `main` redeploy the site without
  fetching. You can also run it by hand from the Actions tab
  (**Update fund data and deploy site › Run workflow**).

## Setup

1. Merge this into `main`.
2. In **Settings › Pages**, set **Source** to **GitHub Actions**.
   GitHub Pages on a private repository needs a paid plan (GitHub Pro or
   higher); on the free plan, make the repository public.
3. Run the workflow once from the Actions tab. The site URL appears on the
   deploy job.

The workflow commits the data file to `main` itself; if you add branch
protection to `main`, allow `github-actions[bot]` to push to it.

## Local development

```sh
npm run fetch   # download fresh data into site/data/funds.json
npm run serve   # http://localhost:8000
npm test        # filter rule tests (Node 20+)
```
