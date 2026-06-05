export function fmtNum(value: number, decimals?: number): string {
  const d = decimals ?? (value >= 1 ? 2 : 6);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtUsd(value: number): string {
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " USD";
}
