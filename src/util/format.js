export const fmt = (n) => "Rs " + Number(n || 0).toLocaleString("en-IN");
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const isoFor = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Short, friendly date for the alert dropdown (e.g. "Sat 21 Jun").
export const fmtShortDate = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
};

// Trigger a file download in the browser.
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Escape a value for CSV (quotes, commas, newlines).
export const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
