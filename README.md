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

The Excluded and All views list about a thousand funds, which takes over a
second to lay out on a mid-range phone, so they show the first 100 rows of
the sorted, filtered list, with a line such as "Showing the first 100 of 1,075
funds." and a **Show all 1,075 funds** button under the table (see
[`site/rowlimit.js`](site/rowlimit.js)). The button shows every row and moves
focus to the first newly shown one. The view counts, the search, the filters,
the sort and the CSV still cover every matching fund; only the rows on screen
are capped. The Passing view, and any list of 100 funds or fewer, shows every
row. Once pressed, every row stays shown through sorting, search, filters and
**Clear filters and search**, until the view changes (with the view buttons, a
link in the changes summary, or a change filter that switches view). It isn't
kept in the URL, so a shared or reloaded link opens with the first 100 rows.
Until **Show all** is pressed, the browser's find-in-page only finds the rows
on screen; the page's search box finds every fund.

When the table has no rows, the line under it says why (see
[`site/empty.js`](site/empty.js)):

- If the view lists no fund at all in the data, whatever the filters and
  search, it says so, e.g. "No fund passes all six rules in the latest data."
  in the Passing view on a day when no fund passes. Clearing the filters
  wouldn't help, so there is no button.
- Otherwise it names each filter and the search that leave no fund, in the
  order of the controls, e.g. `No funds match the type "Hisse Senedi Şemsiye
  Fonu", risk 6 and the search "ata".`, with a **Clear filters and search**
  button. The button clears the type, risk and change filters and the search,
  keeps the view and sort, updates the URL and moves focus to the search box.
  A change filter from the URL that isn't applied yet (before `previous.json`
  has loaded) is not named.

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
6. The 6-month Sharpe ratio (see [below](#sharpe-ratio)) is below 1.0 (a fund
   without a ratio is allowed).

The rules live in [`site/filter.js`](site/filter.js) and run in the browser, so
the page can also list excluded funds with the rule each one broke.

Each rule card under **The Criteria** ends with how many funds that rule
excludes first, e.g. "212 funds out here first." (or "1 fund out here first."
and "No funds out here first."). These are first failures, not independent
failure totals: an excluded fund is counted once, under the first rule it
breaks (the one its Reason column names), so a fund that breaks rules 1, 5 and
6 is counted only under rule 1, and the later rules' counts (rule 6 in
particular) are lower than the number of funds that break them. The counts add
up to the excluded funds, and a line under the heading says so with the total
from the data, e.g. "Each excluded fund is counted once, under the first rule
it breaks, so the cards add up to the 965 excluded funds." Like the cards, it
counts every fund, whatever the view, filters or search. Both are worded by
[`site/rulecounts.js`](site/rulecounts.js).

## Changes since the last update

Under the banner, the page says how many funds entered or left the passing
list since the previous update, e.g. "Since 27 Oct 2026: 3 funds entered, 2
left the passing list.", and marks those funds' rows with `NEW` (in the
Passing and All views) or `LEFT` (in the Excluded and All views). Funds that
left and are no longer in the data have no row, so the summary counts them
apart and lists their codes, e.g. "1 more fund left the passing list and is no
longer in the data: OLD.".

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
  passing list**) since the previous update, and combines with the other
  filters and the search. Funds that entered all pass and funds that left are
  all excluded, so in the Passing or Excluded view it switches to the view
  that lists them; the All view stays. The Passing / Excluded / All counts
  follow it; the sticker, the rule cards and the summary still count every
  fund.
  The URL keeps it as `changed=entered` or `changed=left` (e.g.
  `?view=excluded&changed=left`).
- In the summary, the counts are links that apply the filter and switch to
  the view that lists those funds: the funds that entered in the Passing
  view, those that left in the Excluded view. They keep the sort where the
  view allows it, but clear the type and risk filters and the search, so the
  table shows as many funds as the link says. Funds that left and are no
  longer in the data have no row, so the "left" link doesn't count them and
  only the summary lists them.
- Without `previous.json`, or with a broken one, the page shows nothing about
  changes: the change filter stays hidden, and a `changed` in the URL is
  removed. Until `previous.json` has loaded, the table shows every fund and
  the change filter stays hidden.

## Coverage

Next to the update time, the banner names the price dates the data holds:
the first and last day with TEFAS prices and how many there are, e.g.
`Prices 12 May – 10 Nov 2026 (125 days)` (days without prices, such as
holidays, are not counted). These are the days behind the Sharpe ratios; the
4-week lines use the last four weeks of them. TEFAS gives no date for the period returns, so the page
doesn't give one either. Without valid `priceDates` in the data file it says
`Price dates unknown`.

Under the summary in the panel below the table, one sentence says how many
funds have no 1M return (rule 1 excludes them), no Sharpe ratio (rule 6
allows that) and no risk level, e.g. "Of 1,071 funds, 9 have no 1M return
(rule 1 excludes them), 8 have no Sharpe ratio (rule 6 allows that) and 117
have no risk level." A count of 0 is left out. The counts cover every fund in
the data, whatever the view, filters or search. Both lines are worked out by
[`site/coverage.js`](site/coverage.js).

## Fund size

The **Size** column, after **Risk**, is each fund's total value in TL
(TEFAS's `portfoyBuyukluk`, "portföy büyüklüğü"), so a 5-million-TL niche
fund can be told from a 5-billion-TL one. It comes from the same TEFAS ›
Fon Verileri rows as the daily prices, and is the fund's value on its most
recent price date in the six-month window that has one (normally the latest
price date). It is shown in compact TL: `1.16 bn TL` (billions, two
decimals), `245.3 mn TL` (millions, one decimal), `850 K TL` (thousands) or
whole TL below that, by [`site/size.js`](site/size.js). Funds without a size,
and data fetched before this column was added, show `—`. Sorting by it puts
the largest funds first, and missing sizes always sort last. The size is not
part of any rule.

## Sharpe ratio

The **Sharpe** column is each fund's Sharpe ratio over the last six months of
daily prices, worked out in the browser by [`site/sharpe.js`](site/sharpe.js):

- A fund's daily return is its price change from one price date to the next.
- The risk-free return for each day is the median daily return of the money
  market funds (Para Piyasası Şemsiye Fonu) in the list. It follows the market
  rate without being updated by hand, and covers weekends and holidays, when
  money market funds earn several days of interest at once.
- The ratio is the mean of the daily excess returns (fund minus risk-free)
  divided by their standard deviation, annualised by multiplying by √252.
- Funds with fewer than 21 daily returns in the window, about one month of
  trading days (new funds, or gaps in their prices), show no ratio.
- A ratio based on fewer than 90% of the window's daily returns (a fund
  launched in the last six months, or with long gaps in its prices) has a
  note before it, e.g. `3 MO` for about three months of prices (21 daily
  returns to a month). Its tooltip gives the count, e.g. "Based on about 3
  months of prices (63 of 124 daily returns), not the full 6 months". A fund
  missing only a few days' prices has no note.

Funds with very steady prices (money market and short-term funds) can reach
large values, positive or negative, from small differences against the
risk-free return.

## 4-week price line

The **4 weeks** column draws each fund's daily prices over the last four weeks
of that window as a small line, drawn by [`site/sparkline.js`](site/sparkline.js), so you can
see whether a fund rose steadily, jumped once or fell back. A gap in the line
is a day without a price. Each line is scaled to its own fund's lowest and
highest price, so heights can't be compared between rows. Screen readers read
the change from the first to the last price, e.g. "Price over 4 weeks: up
2.31%". Funds with fewer than two prices show `—`. The column can't be sorted.

On a narrow screen, such as a phone, the table scrolls sideways to reach this
and the other columns. The **Code** column stays at the table's left edge while
it does, so every row still says which fund it is.

## Download

**Download CSV** above the table saves every fund that matches the view, type,
risk and change filters and the search, in table order (sort), including the
rows the Excluded and All views don't show until **Show all** is pressed, as a
CSV file named
`tefas-funds-<view>-<YYYY-MM-DD>.csv`, dated with the day the data was
fetched (Istanbul time). It has the table's columns except the 4-week line,
so the Passing view's file has no Reason column. The file is written by
[`site/csv.js`](site/csv.js):

- Comma separated, with `.` as the decimal point and CRLF line ends (RFC
  4180: fields with a comma, quote or line break are quoted). It starts with a
  UTF-8 byte order mark, so Excel shows Turkish letters correctly.
- Returns are the raw percentages from the data (e.g. `3.0078`, without `%`),
  Sharpe ratios are at full precision and risk is a whole number. The
  **Size (TL)** column is the fund's size in TL as a plain number (e.g.
  `1190580813.75`, no grouping). Missing values are empty cells.
- Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
  leading `'`, so spreadsheet apps don't run it as a formula.

The button is disabled until the data has loaded, and while no fund matches.

## How it works

- [`scripts/fetch_funds.py`](scripts/fetch_funds.py) calls the JSON API behind
  [TEFAS › Fon Getirileri](https://www.tefas.gov.tr/tr/fon-getirileri?fundType=YAT)
  with the page's default settings (funds traded on TEFAS only), and the JSON
  API behind [TEFAS › Fon Verileri](https://www.tefas.gov.tr/tr/fon-verileri)
  for each fund's daily prices over the last six months (TEFAS allows at most
  one month per request, so it asks for four weeks at a time, 15 seconds
  apart), keeping each fund's size from the same rows (see
  [Fund size](#fund-size); a missing or invalid size never fails the
  update). It writes both to
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
  redeploy the site without fetching, after its `tests` job (the two jobs from
  `test.yml`) passes. You can also run it by hand from the Actions tab
  (**Update fund data and deploy site › Run workflow**).
- [`.github/workflows/test.yml`](.github/workflows/test.yml) runs `npm test`
  and the page tests (`npm run test:e2e`, see
  [Local development](#local-development)) as two jobs on every pull request
  and on every push to `main`, with read-only access to the repository.
  `update.yml` runs the same two jobs on a push to `main` and deploys only
  after both pass, so a code change that breaks a test doesn't go live.
  Data runs (the 10:15 trigger, the fallback schedule and manual runs) don't
  run the tests, so they never hold back the daily update, but they don't
  deploy untested code either.
  [`scripts/deploy_source.py`](scripts/deploy_source.py) finds the last
  commit on `main` whose push run of the tests passed. If only `site/data/`
  changed since (the usual day), the data run deploys `site/` as it is.
  Otherwise, while newer code's tests have failed or are still running, it
  deploys `site/` from that commit with the new `site/data/`, and the run's
  summary and a warning name both commits; the newer code goes live once its
  tests pass. If no such commit is found, or the check itself fails, it
  deploys `site/` as it is and warns. The data commit is the same either way.
- [`.github/dependabot.yml`](.github/dependabot.yml) has Dependabot propose
  updates for the GitHub Actions the workflows use and the npm dev
  dependencies (Playwright and axe): once a month, at most one grouped PR for
  each, and only for releases at least 7 days old. Those PRs run `test.yml`
  like any other PR (read-only token) and wait for the owner to merge them.

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
npm test        # unit tests (Node 22.12+ and Python 3.9+)
npm run test:e2e  # page tests in headless Chromium (needs the setup below)
```

`npm test` runs the filter rule and rule evidence (including a check over the
committed data that every fund's reason is its first failing rule), Sharpe
ratio, price line, fund size, data freshness, coverage, URL state, changes,
CSV, empty table message, rule card count, row limit and data fixture tests
(`node --test`), then the Python tests in [`tests/`](tests/)
(`python3 -m unittest discover -s tests -v`), and fails if either suite
fails. The fetch script tests cover its parsing (including each fund's size
from its latest valid value), validation, output format,
retries, atomic write and keeping of `previous.json` with fixtures and mocks,
the trigger check tests
cover its decision with fixture `gh run list` output, and the deploy source
tests cover the choice of code to deploy with fixture `gh run list` output
and a throwaway git repository, so they need no network and no packages
(only `git`).

`npm test` needs no `npm install`. The page tests do: run `npm ci` and
`npx playwright install chromium` once, then `npm run test:e2e`. They serve
`site/` on `http://127.0.0.1:8137` and open it in headless Chromium with
[Playwright](https://playwright.dev), using the committed
`site/data/funds.json` with four more funds made to pass and known fund sizes
(see [`e2e/fixtures.js`](e2e/fixtures.js)).

Neither suite depends on how many funds pass on the committed day, which
swings with the market and can be none. Checks that need passing funds use
data built from the committed file by
[`tests/fund-fixtures.mjs`](tests/fund-fixtures.mjs), in which some funds
always pass; checks over the committed file as it is only assert what holds
on any day (each fund's reason is its first failing rule, and the page shows
the counts `filter.js` works out). Both suites also check the rules, the
changes, coverage and CSV logic, and the page itself (counts, rows, change
summary, no errors, and axe in the empty Passing view) on copies of the
committed data in which no fund passes, or exactly one does.

The specs in [`e2e/`](e2e/) check that the page loads
without errors; that the sticker, the Passing / Excluded / All counts and the
rule cards match the numbers worked out from the data with `filter.js` and
`sharpe.js`, worded as first failures (e.g. "212 funds out here first."), and
that the line under The Criteria gives the Excluded count as the total the
cards add up to and fits a 320 px screen; that the table lists the right rows (with a Reason column only
for excluded funds); that the Excluded and All views show the first 100 rows of
the sorted list with a **Show all** button naming the full count, which shows
every row and focuses the first new one from the mouse or keyboard, lasts
through sorting, search and filters until the view changes, stays out of the
URL and fits a 320 px screen, while the Passing view and lists of 100 or fewer
are never capped; that search and column sorting work, and are kept in
and restored from the URL; that every fund with two prices has a labelled
4-week price line (and the rest show `—`), and that its column can't be
sorted; that the Size column follows Risk in every view, shows each fund's
size in compact TL, sorts both ways with missing sizes last, is restored from
`?sort=size&dir=asc`, and shows `—` without errors for data that has no
sizes; that an empty table says no fund passes all six rules when none does
(without a button), or names exactly the filters and search that leave no
fund, shown as text and fitting a 320 px screen, with a button that clears
them from the mouse or keyboard, keeping the view and sort, and clears them
from the URL; that the type and risk filters list the types in
the data, narrow the rows and view counts (but not the sticker or rule
cards), work from the keyboard and at 320 px wide, and are kept in and
restored from the URL, with unknown values ignored; that the banner's price dates and the coverage sentence match what
`coverage.js` works out from the data, don't change with the view, filters or
search, say `Price dates unknown` without errors when `priceDates` is missing
or malformed, and fit a 320 px screen; that the stale data
warning appears only when the data is old; that a failed data request
shows an error; and that the changes summary and the `NEW` / `LEFT` badges
match what `changes.js` works out from a `previous.json` fixture with known
changes (and from the committed one), fit a 320 px screen, and are left out
without errors when `previous.json` is missing or broken; that the change
filter and the summary's links show exactly the funds that entered or left
in the view that lists them (the filter combining with the other filters, the
links clearing them), work from the keyboard and at 320 px wide, are
kept in and restored from the URL, and are dropped from the URL when
`previous.json` is missing or broken; that the Code column, with its `NEW` /
`LEFT` badges, stays at the table's left edge over the other cells when the
table is scrolled fully sideways at 320 and 393 px in every view, leaves the
column widths at 1280 px as they were, and that a header reached with Tab or
Shift+Tab at 320 px is scrolled clear of it; and that Download
CSV saves exactly the table's rows and columns for the view, filters, search
and sort, including the rows a capped view doesn't show yet (with the right file name, byte order mark and raw numbers), is
disabled while no fund matches, and works from the keyboard and at 320 px
wide. [`e2e/a11y.spec.js`](e2e/a11y.spec.js) checks accessibility: it runs
[axe-core](https://github.com/dequelabs/axe-core) (through
`@axe-core/playwright`) with the WCAG 2.0 and 2.1 A and AA rules, plus the
rules that keep all content inside landmarks under one `<main>`, and expects
no violations in the Passing, Excluded and All views at 1280 px (with the
changes summary and badges, and in the Excluded and All views both with the
Show all button and with every row), the Passing view and the All view with
the Show all button at 320 px, a search that
matches nothing, filters and a search that leave no fund (with the button that
clears them), stale data and a failed data request; and it tabs through
every control on the page, with rows, with the Show all button and with the
clear button showing, and
checks that each one gets a focus outline with at least 3:1 contrast against
the colour behind it.
