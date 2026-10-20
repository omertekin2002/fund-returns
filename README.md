# TEFAS Fund Screener

A static site on GitHub Pages that lists TEFAS securities investment funds
(Menkul Kıymet Yatırım Fonları, `fundType=YAT`) that pass a set of return
and Sharpe ratio criteria. A GitHub Actions workflow refreshes the data every weekday
(Monday to Friday) at 10:15 Istanbul time. A [cron-job.org](https://cron-job.org)
job starts it, because GitHub starts its own scheduled runs hours late. The
page shows the time the data was actually fetched.

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
6. The 4-week Sharpe ratio (see [below](#sharpe-ratio)) is below 1.0 (a fund
   without a ratio is allowed).

The rules live in [`site/filter.js`](site/filter.js) and run in the browser, so
the page can also list excluded funds with the rule each one broke.

## Sharpe ratio

The **Sharpe** column is each fund's Sharpe ratio over the last four weeks of
daily prices, worked out in the browser by [`site/sharpe.js`](site/sharpe.js):

- A fund's daily return is its price change from one price date to the next.
- The risk-free return for each day is the median daily return of the money
  market funds (Para Piyasası Şemsiye Fonu) in the list. It follows the market
  rate without being updated by hand, and covers weekends and holidays, when
  money market funds earn several days of interest at once.
- The ratio is the mean of the daily excess returns (fund minus risk-free)
  divided by their standard deviation, annualised by multiplying by √252.
- Funds with fewer than 10 daily returns in the window (new funds, or gaps in
  their prices) show no ratio.

Over four weeks the ratio is noisy, and funds with very steady prices (money
market and short-term funds) can reach large values, positive or negative,
from small differences against the risk-free return.

## How it works

- [`scripts/fetch_funds.py`](scripts/fetch_funds.py) calls the JSON API behind
  [TEFAS › Fon Getirileri](https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT)
  with the page's default settings (funds traded on TEFAS only), and the JSON
  API behind [TEFAS › Fon Verileri](https://www.tefas.gov.tr/tr/fon-verileri)
  for each fund's daily prices over the last four weeks (TEFAS allows at most
  one month per request). It writes both to
  [`site/data/funds.json`](site/data/funds.json). It uses only the Python
  standard library and refuses to overwrite the file if a response looks
  wrong.
- [`.github/workflows/update.yml`](.github/workflows/update.yml) runs the
  script, commits the new data file (giving a history of every update), and
  deploys `site/` to GitHub Pages. cron-job.org starts it at 10:15 Istanbul
  time on weekdays (see [Daily trigger](#daily-trigger-cron-joborg)). Its own
  GitHub schedule (12:37 Istanbul time, Monday to Friday) is a fallback: it
  does nothing if that day's data is already in, and otherwise fetches it,
  usually a few hours late. Pushes to `main` redeploy the site without
  fetching. You can also run it by hand from the Actions tab
  (**Update fund data and deploy site › Run workflow**).
- [`.github/workflows/test.yml`](.github/workflows/test.yml) runs `npm test`
  (see [Local development](#local-development)) on every pull request and on
  every push to `main`, with read-only access to the repository. It does not
  hold back the daily update or the deploy.

The page's look follows [`DESIGN.md`](DESIGN.md) (a Dell 1996 catalog style:
black page frame, flat colour blocks, Arial Black headings over Times body).

## Setup

1. In **Settings › Pages**, set **Source** to **GitHub Actions**.
   GitHub Pages on a private repository needs a paid plan (GitHub Pro or
   higher); on the free plan, make the repository public.
2. Run the workflow once from the Actions tab. The site URL appears on the
   deploy job.

The workflow commits the data file to `main` itself; if you add branch
protection to `main`, allow `github-actions[bot]` to push to it.

### Daily trigger (cron-job.org)

1. Create a GitHub token: **Settings › Developer settings › Personal access
   tokens › Fine-grained tokens › Generate new token**.
   - **Repository access:** Only select repositories › `fund-returns`.
   - **Permissions:** Repository permissions › **Actions: Read and write**.
   - Copy the token. When it expires, the cron-job.org job starts failing
     (HTTP 401) and you need to create a new one.
2. On [cron-job.org](https://cron-job.org), create a cron job:
   - **URL:** `https://api.github.com/repos/omertekin2002/fund-returns/actions/workflows/update.yml/dispatches`
   - **Schedule:** custom, minute `15`, hour `10`, days of week Monday to
     Friday, time zone `Europe/Istanbul`.
   - **Advanced › Request method:** `POST`
   - **Advanced › Headers:**
     - `Accept: application/vnd.github+json`
     - `Authorization: Bearer <token>`
     - `X-GitHub-Api-Version: 2022-11-28`
     - `Content-Type: application/json`
   - **Advanced › Request body:** `{"ref":"main"}`
   - Turn on the email notification for failed runs.
3. Use **Test run**. GitHub answers `204 No Content`, and a new
   `workflow_dispatch` run appears in the Actions tab.

## Local development

```sh
npm run fetch   # download fresh data into site/data/funds.json
npm run serve   # http://localhost:8000
npm test        # all tests (Node 20+ and Python 3)
```

`npm test` runs the filter rule and Sharpe ratio tests (`node --test`), then
the fetch script tests in
[`tests/test_fetch_funds.py`](tests/test_fetch_funds.py)
(`python3 -m unittest discover -s tests -v`), and fails if either suite
fails. The fetch script tests cover its parsing, validation, output format,
retries and atomic write with fixtures and mocks, so they need no network
and no packages.
