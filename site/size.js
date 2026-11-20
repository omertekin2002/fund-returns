// A fund's size, its total value in TL on its latest price date (the "size"
// field fetch_funds.py writes), as the Size column shows it. No DOM access,
// so node --test can check it.

// From the largest unit down: the smallest value written in it, its name and
// how many decimals it keeps.
const UNITS = [
  { min: 1e9, name: "bn", digits: 2 },
  { min: 1e6, name: "mn", digits: 1 },
  { min: 1e3, name: "K", digits: 0 },
  { min: 0, name: "", digits: 0 },
];

const formats = new Map(
  UNITS.map((u) => [
    u.digits,
    new Intl.NumberFormat("en-US", { minimumFractionDigits: u.digits, maximumFractionDigits: u.digits }),
  ]),
);

// A fund's size as a number in TL, or null when it is missing or not a
// positive number (data from before the Size column has no "size" field).
export function fundSize(fund) {
  const size = fund?.size;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null;
}

// Compact TL, e.g. "1.16 bn TL", "245.3 mn TL", "850 K TL" or "512 TL"; "—"
// when missing. A value that would round up to 1,000 of its unit is written
// in the next unit up ("1.0 mn TL", not "1,000 K TL").
export function formatSize(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  let index = UNITS.findIndex((u) => value >= u.min);
  if (index > 0) {
    const { min, digits } = UNITS[index];
    const factor = 10 ** digits;
    if (Math.round((value / (min || 1)) * factor) / factor >= 1000) index -= 1;
  }
  const { min, name, digits } = UNITS[index];
  const number = formats.get(digits).format(value / (min || 1));
  return name ? `${number} ${name} TL` : `${number} TL`;
}
