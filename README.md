# TEFAS Fund Screener

A static site on GitHub Pages that lists TEFAS securities investment funds
(Menkul Kıymet Yatırım Fonları, `fundType=YAT`) that pass a set of return
and Sharpe ratio criteria. A GitHub Actions workflow refreshes the data every weekday
(Monday to Friday) at 10:15 Istanbul time. A [cron-job.org](https://cron-job.org)
job starts it, because GitHub starts its own scheduled runs hours late. The
page shows the time the data was actually fetched, and shows a warning when a
whole weekday has gone by without an update (see
[`site/freshness.js`](site/freshness.js)).
The table can be narrowed to one fund type (umbrella) and one risk level
(1–7, exactly that level; funds with no risk level only show without a risk
filter). The Passing / Excluded / All counts follow these filters; the
sticker, the summary and the rule cards always count every fund.
The page URL keeps the view, sort, search and filters (e.g.
`?view=excluded&sort=sharpe&dir=asc&q=ata`,
`?type=Hisse+Senedi+Şemsiye+Fonu&risk=6` or `?view=excluded&changed=left`),
so links can be shared (see [`site/urlstate.js`](site/urlstate.js)). A type
that matches no fund, a risk outside 1–7, or a `changed` other than `entered`
or `left` is ignored.

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

### Rule evidence

The Reason column shows only the first rule a fund breaks. The **Rules** button
before each fund code opens a row under the fund with its result on all six
rules: the fund's value (e.g. `3M 12.40%`, or `No 1Y return`), what the rule
needs, and one of three outcomes:

- **Pass:** the value meets the rule.
- **Fail:** the value breaks the rule. Failures are tinted like the rule's
  card, and the first one, which the Reason column shows, is marked `REASON`.
- **Missing, allowed:** the value is absent and the rule allows that (a missing
  3M, 6M or 1Y return, no Sharpe ratio, or fewer than two returns for the
  longer-beats-shorter rule). A missing 1M return is a failure.

The evidence comes from `ruleEvidence` in `filter.js`, and the Reason column's
rule is its first failure, so the two always agree. Open rows stay open while
you sort, search or filter, but aren't kept in the URL.

## Changes since the last update

Under the banner, the page says how many funds entered or left the passing
list since the previous update, e.g. "Since 27 Oct 2026: 3 funds entered, 2
left the passing list.", and marks those funds' rows with `NEW` (in the
Passing and All views) or `LEFT` (in the Excluded and All views). Funds that
left and are no longer in the data have no row, so the summary lists their
codes.

- Before each update, [`scripts/fetch_funds.py`](scripts/fetch_funds.py)
  keeps the existing `site/data/funds.json` as
  [`site/data/previous.json`](site/data/previous.json), but only if it is
  from an earlier Istanbul day. A second run on the same day keeps the
  existing `previous.json`, so the page always compares against the last
  earlier day. A failed fetch changes neither file.
- After the table is on screen, the page loads `previous.json` and checks
  both files' funds with the same rules (and each file's own Sharpe ratios
  and risk-free return), in [`site/changes.js`](site/changes.js). A fund
  entered if it passes now and didn't pass before (or wasn't in the previous
  data); it left if it passed before and doesn't pass now (or is no longer in
  the data).
- The change filter next to the type and risk filters narrows the table to
  the funds that entered (**Entered the passing list**) or left (**Left the
  passing list**) since the previous update, and combines with the view, the
  other filters and the search. The Passing / Excluded / All counts follow
  it; the sticker, the rule cards and the summary still count every fund.
  The URL keeps it as `changed=entered` or `changed=left` (e.g.
  `?view=excluded&changed=left`).
- In the summary, the counts are links that apply the filter and switch to
  the view that lists those funds: the funds that entered in the Passing
  view, those that left in the Excluded view. They keep the other filters and
  the search. Funds that left and are no longer in the data have no row, so
  only the summary lists them.
- Without `previous.json`, or with a broken one, the page shows nothing about
  changes: the change filter stays hidden, and a `changed` in the URL is
  removed. Until `previous.json` has loaded, the table shows every fund and
  the change filter stays hidden.

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

## 4-week price line

The **4 weeks** column draws each fund's daily prices over the same four weeks
as a small line, drawn by [`site/sparkline.js`](site/sparkline.js), so you can
see whether a fund rose steadily, jumped once or fell back. A gap in the line
is a day without a price. Each line is scaled to its own fund's lowest and
highest price, so heights can't be compared between rows. Screen readers read
the change from the first to the last price, e.g. "Price over 4 weeks: up
2.31%". Funds with fewer than two prices show `—`. The column can't be sorted.

## Download

**Download CSV** above the table saves the rows the table shows, in the same
order (view, type and risk filters, search and sort), as a CSV file named
`tefas-funds-<view>-<YYYY-MM-DD>.csv`, dated with the day the data was
fetched (Istanbul time). It has the table's columns except the 4-week line,
so the Passing view's file has no Reason column. The file is written by
[`site/csv.js`](site/csv.js):

- Comma separated, with `.` as the decimal point and CRLF line ends (RFC
  4180: fields with a comma, quote or line break are quoted). It starts with a
  UTF-8 byte order mark, so Excel shows Turkish letters correctly.
- Returns are the raw percentages from the data (e.g. `3.0078`, without `%`),
  Sharpe ratios are at full precision and risk is a whole number. Missing
  values are empty cells.
- Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
  leading `'`, so spreadsheet apps don't run it as a formula.

The button is disabled until the data has loaded, and while no fund matches.

## How it works

- [`scripts/fetch_funds.py`](scripts/fetch_funds.py) calls the JSON API behind
  [TEFAS › Fon Getirileri](https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT)
  with the page's default settings (funds traded on TEFAS only), and the JSON
  API behind [TEFAS › Fon Verileri](https://www.tefas.gov.tr/tr/fon-verileri)
  for each fund's daily prices over the last four weeks (TEFAS allows at most
  one month per request). It writes both to
  [`site/data/funds.json`](site/data/funds.json), after keeping an earlier
  day's file as `site/data/previous.json` (see
  [Changes since the last update](#changes-since-the-last-update)). It uses
  only the Python standard library and refuses to overwrite the file if a
  response looks wrong.
- [`.github/workflows/update.yml`](.github/workflows/update.yml) runs the
  script, commits the new data file and `previous.json` together (giving a
  history of every update; `previous.json` is the same content as an earlier
  `funds.json`, so git stores it only once), and
  deploys `site/` to GitHub Pages. cron-job.org starts it at 10:15 Istanbul
  time on weekdays (see [Daily trigger](#daily-trigger-cron-joborg)). Its own
  GitHub schedule (12:37 Istanbul time, Monday to Friday) is a fallback: it
  does nothing if that day's data is already in, and otherwise fetches it,
  usually a few hours late. If cron-job.org didn't start a run that day, the
  fallback also opens an issue labelled `trigger-missed` that mentions the
  owner (see [Daily trigger](#daily-trigger-cron-joborg)). Pushes to `main`
  redeploy the site without fetching. You can also run it by hand from the Actions tab
  (**Update fund data and deploy site › Run workflow**).
- [`.github/workflows/test.yml`](.github/workflows/test.yml) runs `npm test`
  and the page tests (`npm run test:e2e`, see
  [Local development](#local-development)) as two jobs on every pull request
  and on every push to `main`, with read-only access to the repository. It
  does not hold back the daily update or the deploy.

The page's look follows [`DESIGN.md`](DESIGN.md) (a Dell 1996 catalog style:
black page frame, flat colour blocks, Arial Black headings over Times body).

## Setup

1. In **Settings › Pages**, set **Source** to **GitHub Actions**. The
   repository is public, so this works on GitHub's free plan.
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

#### When the trigger stops working

The 12:37 fallback run checks whether a `workflow_dispatch` run of the
workflow was started that day (Istanbul time). If none was, it opens an issue
titled **⚠️ The 10:15 daily trigger didn't run** with the label
`trigger-missed`, which mentions the owner and links the fallback run. On
later days without a trigger it comments on that issue instead of opening a
new one. The decision is made by
[`scripts/check_trigger.py`](scripts/check_trigger.py).

When the issue appears:

1. On cron-job.org, open the job's history. HTTP 401 means the token has
   expired.
2. Create a new token as in step 1 above and replace the `Authorization`
   header of the cron-job.org job with it.
3. Use **Test run** to check it (step 3 above).

The issue closes itself on the next weekday the trigger starts a run. A
dispatch run whose fetch failed (for example TEFAS was down) still counts as
a working trigger; that failure shows up in the Actions tab. If you pause the
cron-job.org job on purpose, close the issue by hand.

## Local development

```sh
npm run fetch   # download fresh data into site/data/funds.json
npm run serve   # http://localhost:8000
npm test        # unit tests (Node 20+ and Python 3.9+)
npm run test:e2e  # page tests in headless Chromium (needs the setup below)
```

`npm test` runs the filter rule and rule evidence (including a check over the
committed data that every fund's reason is its first failing rule), Sharpe
ratio, price line, data freshness, URL state, changes and CSV tests
(`node --test`), then the Python tests in [`tests/`](tests/)
(`python3 -m unittest discover -s tests -v`), and fails if either suite
fails. The fetch script tests cover its parsing, validation, output format,
retries, atomic write and keeping of `previous.json` with fixtures and mocks,
and the trigger check tests
cover its decision with fixture `gh run list` output, so they need no network
and no packages.

`npm test` needs no `npm install`. The page tests do: run `npm ci` and
`npx playwright install chromium` once, then `npm run test:e2e`. They serve
`site/` on `http://127.0.0.1:8137` and open it in headless Chromium with
[Playwright](https://playwright.dev), using the committed
`site/data/funds.json`. The specs in [`e2e/`](e2e/) check that the page loads
without errors; that the sticker, the Passing / Excluded / All counts and the
rule cards match the numbers worked out from the data with `filter.js` and
`sharpe.js`; that the table lists the right rows (with a Reason column only
for excluded funds); that search and column sorting work, and are kept in
and restored from the URL; that every fund with two prices has a labelled
4-week price line (and the rest show `—`), and that its column can't be
sorted; that the type and risk filters list the types in
the data, narrow the rows and view counts (but not the sticker or rule
cards), work from the keyboard and at 320 px wide, and are kept in and
restored from the URL, with unknown values ignored; that the stale data
warning appears only when the data is old; that a failed data request
shows an error; and that the changes summary and the `NEW` / `LEFT` badges
match what `changes.js` works out from a `previous.json` fixture with known
changes (and from the committed one), fit a 320 px screen, and are left out
without errors when `previous.json` is missing or broken; that the change
filter and the summary's links show exactly the funds that entered or left,
combine with the other filters, work from the keyboard and at 320 px wide, are
kept in and restored from the URL, and are dropped from the URL when
`previous.json` is missing or broken; and that Download
CSV saves exactly the table's rows and columns for the view, filters, search
and sort (with the right file name, byte order mark and raw numbers), is
disabled while no fund matches, and works from the keyboard and at 320 px
wide; and that the rule evidence row shows six rules matching `ruleEvidence`
(no failure for a passing fund, the Reason column's rule as the first failure
for an excluded one, rule 6 as missing but allowed without a Sharpe ratio),
opens and closes from the keyboard with `aria-expanded` following, stays open
after a sort, search or view change, and fits a 320 px screen.
