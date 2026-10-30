// Which funds entered or left the passing list since the previous update.
// data/previous.json is the last earlier day's data/funds.json (kept by
// scripts/fetch_funds.py); both are classified with the same rules.
import { exclusionReason } from "./filter.js";
import { riskFreeReturns, sharpeRatio } from "./sharpe.js";

// Adds each fund's 4-week Sharpe ratio and its exclusion reason (null if it
// passes every rule) to the funds of a data file.
export function classifyFunds(funds) {
  const riskFree = riskFreeReturns(funds);
  return funds.map((raw) => {
    const fund = { ...raw, sharpe: sharpeRatio(raw.prices, riskFree) };
    return { ...fund, reason: exclusionReason(fund) };
  });
}

// Compares two classified fund lists. A fund entered if it passes now and
// didn't pass before (including funds new to the data); it left if it passed
// before and doesn't pass now (including funds gone from the data, which are
// also listed in "gone"). Each list holds sorted fund codes.
export function membershipChanges(current, previous) {
  const passingCodes = (funds) => new Set(funds.filter((f) => !f.reason).map((f) => f.code));
  const passesNow = passingCodes(current);
  const passedBefore = passingCodes(previous);
  const inData = new Set(current.map((f) => f.code));
  const sorted = (codes) => [...codes].sort((a, b) => a.localeCompare(b, "tr"));
  const entered = sorted([...passesNow].filter((code) => !passedBefore.has(code)));
  const left = sorted([...passedBefore].filter((code) => !passesNow.has(code)));
  return { entered, left, gone: left.filter((code) => !inData.has(code)) };
}

const countFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", dateStyle: "medium" });

const funds = (n) => `${countFormat.format(n)} ${n === 1 ? "fund" : "funds"}`;

// The one-line summary of the changes since the previous update fetched at
// previousFetchedAt (an ISO timestamp), as a list of parts: plain text, and
// { text, changed } for the counts of funds that entered or left (changed is
// "entered" or "left"), which the page turns into links to those funds. Zero
// counts are plain text. A link counts only the funds it shows, so funds that
// left and are no longer in the data (which have no row) are counted and
// listed by code after it. Joined, e.g. "Since 27 Oct 2026: 3 funds entered,
// 2 left the passing list. 1 more fund left the passing list and is no longer
// in the data: OLD."
export function changesSummaryParts({ entered, left, gone }, previousFetchedAt) {
  const date = new Date(previousFetchedAt);
  const since =
    typeof previousFetchedAt === "string" && !Number.isNaN(date.getTime())
      ? `Since ${dateFormat.format(date)}`
      : "Since the previous update";
  const listed = left.filter((code) => !gone.includes(code));
  const goneText = (more) =>
    `${countFormat.format(gone.length)}${more} ${gone.length === 1 ? "fund" : "funds"} left the passing list and ` +
    `${gone.length === 1 ? "is" : "are"} no longer in the data: ${gone.join(", ")}.`;
  if (entered.length === 0 && listed.length === 0) {
    return [`${since}: ${gone.length > 0 ? goneText("") : "no fund entered or left the passing list."}`];
  }
  let parts;
  if (listed.length === 0) {
    parts = [`${since}: `, { text: `${funds(entered.length)} entered`, changed: "entered" }, " the passing list."];
  } else if (entered.length === 0) {
    parts = [`${since}: `, { text: `${funds(listed.length)} left`, changed: "left" }, " the passing list."];
  } else {
    parts = [
      `${since}: `,
      { text: `${funds(entered.length)} entered`, changed: "entered" },
      ", ",
      { text: `${countFormat.format(listed.length)} left`, changed: "left" },
      " the passing list.",
    ];
  }
  if (gone.length > 0) parts.push(` ${goneText(" more")}`);
  return parts;
}

// The summary above as one string.
export function changesSummary(changes, previousFetchedAt) {
  return changesSummaryParts(changes, previousFetchedAt)
    .map((part) => (typeof part === "string" ? part : part.text))
    .join("");
}
