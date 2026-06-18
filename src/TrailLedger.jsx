import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase";

// ── Constants ──────────────────────────────────────────────────────────
const EXPENSE_CATS = [
  { key: "food", label: "Food & Bev" },
  { key: "fuel", label: "Fuel" },
  { key: "staff", label: "Staff" },
  { key: "commission", label: "Commission" },
];
const ACTIVITIES = ["Pieter Both", "7 Cascades Hiking", "Canyoning 7 Cascades", "Le Morne", "Le Pouce"];
const ACTIVITY_PRICE = {
  "Pieter Both": 4000,
  "7 Cascades Hiking": 2000,
  "Canyoning 7 Cascades": 4000,
  "Le Morne": 2000,
  "Le Pouce": 2000,
}; // per person — direct bookings

// Freshverde operator price list (per person). Pieter Both falls back to direct.
const FRESHVERDE_PRICE = {
  "Pieter Both": 4000,
  "7 Cascades Hiking": 1500,
  "Canyoning 7 Cascades": 3000,
  "Le Morne": 1500,
  "Le Pouce": 1500,
};

const SOURCES = ["Direct", "Freshverde"];
// Per-person price for an activity given the booking source.
const priceFor = (activity, source) => {
  const table = source === "Freshverde" ? FRESHVERDE_PRICE : ACTIVITY_PRICE;
  return table[activity] != null ? table[activity] : 0;
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const PAYMENTS = ["Cash", "Card", "Transfer", "Unpaid"];
const STAFF = ["Darryl", "Gayan", "Tirou", "Steeve", "Nesta"];
// Staff pay per staff member, by activity. Some depend on pax (≥4 = higher).
const staffRate = (activity, pax) => {
  const p = Number(pax) || 0;
  switch (activity) {
    case "Canyoning 7 Cascades": return 2500;
    case "Pieter Both": return 3000;
    case "7 Cascades Hiking": return p >= 4 ? 2000 : 1500;
    case "Le Morne": return p >= 4 ? 2000 : 1500;
    case "Le Pouce": return p >= 4 ? 2000 : 1500;
    default: return 1500;
  }
};
const STORE_KEY = "trailledger.v1";
const SETTINGS_KEY = "trailledger.settings.v1";

// Auto-calc rates
const FOOD_PER_PAX = 200; // Rs per person

// ── Storage (localStorage; data persists on your device) ───────────────
const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
};
const save = (data) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
};

const defaultSettings = () => ({ bankBalance: "", bankAsOf: todayISO(), cashInHand: "", cashAsOf: todayISO(), fixedCosts: [], guidePaid: {}, invoiceSeq: 5, company: { name: "OFFLINE Ltd", address: "Port-Louis", phone: "57310380", accNumber: "000072388064", accName: "Ally Darryl", bank: "Mauritius Commercial Bank" } });
const loadSettings = () => {
  try { return { ...defaultSettings(), ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; }
  catch { return defaultSettings(); }
};
const saveSettings = (data) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch {}
};

// Cloud-sync bookkeeping: remember when we last reconciled with Supabase.
const STAMP_KEY = "trailledger.syncedAt";
const getStamp = () => { try { return localStorage.getItem(STAMP_KEY) || ""; } catch { return ""; } };
const setStamp = (s) => { try { localStorage.setItem(STAMP_KEY, s); } catch {} };

// Short, friendly date for the alert dropdown (e.g. "Sat 21 Jun").
const fmtShortDate = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  } catch { return iso; }
};

// Count every booking across all dates (used to protect against empty wipes).
const countBookings = (reports) =>
  Object.values(reports || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);

// Order-independent serialization: sorts object keys recursively so the SAME
// booking compares equal even after Supabase's jsonb storage reorders its keys.
const stableKey = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableKey(v[k])).join(",") + "}";
};

// Merge two booking sets without losing anything: union per date, true
// duplicates (same content, any key order) removed. On a genuine conflict both
// versions are kept (a harmless duplicate you can delete) rather than dropping one.
const mergeReports = (a, b) => {
  const out = {};
  const dates = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  dates.forEach((d) => {
    const la = (a && a[d]) || [];
    const lb = (b && b[d]) || [];
    const merged = [];
    const seen = new Set();
    [...la, ...lb].forEach((item) => {
      const k = stableKey(item);
      if (!seen.has(k)) { merged.push(item); seen.add(k); }
    });
    if (merged.length) out[d] = merged;
  });
  return out;
};

const fmt = (n) => "Rs " + Number(n || 0).toLocaleString("en-IN");
const todayISO = () => new Date().toISOString().slice(0, 10);

// Trigger a file download in the browser.
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Escape a value for CSV (quotes, commas, newlines).
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const isoFor = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const emptyForm = () => ({
  activity: "Pieter Both", client: "", pax: 1, price: String(ACTIVITY_PRICE["Pieter Both"]), payment: "Cash",
  source: "Direct", costsFrom: "Hand", separatePay: false,
  phone: "", email: "", notes: "", staffNames: [],
  food: String(FOOD_PER_PAX * 1), fuel: String(fuelRate([])),
  staff: "", staffOverride: "", commission: "",
});

// Map a free-text activity name to one of our activity types
const matchActivity = (text) => {
  const t = (text || "").toLowerCase();
  if (t.includes("canyon")) return "Canyoning 7 Cascades";
  if (t.includes("morne")) return "Le Morne";
  if (t.includes("pouce")) return "Le Pouce";
  if (t.includes("cascade")) return "7 Cascades Hiking";
  if (t.includes("pieter") || t.includes("both")) return "Pieter Both";
  return "Pieter Both"; // default
};

// Parse a forwarded WhatsApp booking message.
// Returns { form patch, date|null } — tolerant of label variations & spacing.
const parseWhatsApp = (raw) => {
  const get = (labels) => {
    for (const lbl of labels) {
      const re = new RegExp(`${lbl}\\s*[:：]\\s*(.+)`, "i");
      const m = raw.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };
  const hike = get(["hike", "climb", "canyon", "activity", "tour"]);
  const persons = get(["number of persons", "no of persons", "persons", "pax", "people"]);
  const dateStr = get(["date"]);
  const name = get(["name", "client"]);
  const phone = get(["phone", "contact", "tel", "mobile", "whatsapp"]);
  const email = get(["email", "e-mail", "mail"]);

  // Normalise the date to YYYY-MM-DD if we can read it
  let date = null;
  if (dateStr) {
    const iso = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const dmy = dateStr.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (iso) date = `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
    else if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
    else { const d = new Date(dateStr); if (!isNaN(d)) date = d.toISOString().slice(0,10); }
  }

  const patch = {};
  if (hike) {
    patch.activity = matchActivity(hike);
    if (ACTIVITY_PRICE[patch.activity] != null) patch.price = String(ACTIVITY_PRICE[patch.activity]);
  }
  const paxNum = persons ? (parseInt(persons, 10) || 1) : 1;
  if (persons) patch.pax = paxNum;
  patch.food = String(paxNum * FOOD_PER_PAX); // auto Food & Bev
  patch.fuel = String(fuelRate([]));          // auto Fuel (no crew yet → 0)
  if (name) patch.client = name;
  if (phone) patch.phone = phone.replace(/[^\d+]/g, "");
  if (email) patch.email = email;
  if (hike) patch.notes = `Hike: ${hike}`;

  return { patch, date, matched: !!(hike || name || persons || dateStr) };
};

// Smart label-free parser. Reads messages like:
//   Canyoning
//   Tarzan
//   +230 5789 1234
//   3pax
//   28th june
// Rule: line 1 = activity, line 2 = name. The remaining lines are detected by
// SHAPE, in any order: a line with "+" or mostly digits = phone; a number or
// "Npax" = pax; a line containing a month word (or a date pattern) = date.
// Returns { patch, date, missing: [...] } so the caller can flag what to fix.
const parseSmart = (raw, selectedYear) => {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const patch = {};
  let date = null;
  const missing = [];
  if (!lines.length) return { patch, date, missing: ["activity", "name", "pax", "date"], matched: false };

  // Line 1 = activity (always, by your rule)
  const activityRaw = lines[0];
  patch.activity = matchActivity(activityRaw);
  // Was the activity genuinely recognized (vs the default fallback)?
  const activityRecognized = matchActivityStrict(activityRaw) != null;
  patch.price = String(ACTIVITY_PRICE[patch.activity] != null ? ACTIVITY_PRICE[patch.activity] : 0);
  patch.notes = `Hike: ${activityRaw}`;

  // Line 2 = name (if present)
  if (lines[1]) patch.client = lines[1];
  else missing.push("name");

  const monthRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  let foundPax = false, foundDate = false, foundPhone = false;

  // Scan remaining lines (from line 3 on) by shape.
  lines.slice(2).forEach((line) => {
    const l = line.toLowerCase();
    const digits = (line.match(/\d/g) || []).length;
    const looksLikeDate = monthRe.test(l) || /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(l) || /\d{4}-\d{1,2}-\d{1,2}/.test(l);
    // Date FIRST (so a numeric date like 05/07/2026 isn't mistaken for a phone).
    if (!foundDate && looksLikeDate) {
      const d = parseOperatorDate(line, selectedYear) || (() => {
        const dmy = line.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
        const iso = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
        return null;
      })();
      if (d) { date = d; foundDate = true; return; }
    }
    // Phone: starts with + or is mostly digits (7+) and isn't a date line
    if (!foundPhone && (line.startsWith("+") || (digits >= 7 && !looksLikeDate))) {
      patch.phone = line.replace(/[^\d+]/g, ""); foundPhone = true; return;
    }
    // Pax: a "Npax"/"N pax"/"N people" or a bare small number
    if (!foundPax) {
      const pm = l.match(/(\d+)\s*(pax|p|people|persons?|adults?)?/);
      if (pm && (/(pax|p|people|persons?|adults?)/.test(l) || /^\d+$/.test(l))) {
        patch.pax = parseInt(pm[1], 10) || 1; foundPax = true; return;
      }
    }
  });

  if (!foundPax) { patch.pax = 1; missing.push("pax"); }
  if (!foundDate) missing.push("date");
  patch.food = String((patch.pax || 1) * FOOD_PER_PAX);
  patch.fuel = String(fuelRate([]));

  return { patch, date, missing, activityRecognized, matched: true };
};

// ── Tour-operator format parser ────────────────────────────────────────
// Handles messages like:
//   Hiking trip to 7 Cascades
//   Name of client:
//     - Rebecca Allen (Adult)
//     - Adult
//   Date: 15th June
// Supports several bookings pasted together. Pax = number of client lines.
const MONTHS_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const matchActivityStrict = (text) => {
  const t = (text || "").toLowerCase();
  if (t.includes("canyon")) return "Canyoning 7 Cascades";
  if (t.includes("morne")) return "Le Morne";
  if (t.includes("pouce")) return "Le Pouce";
  if (t.includes("cascade")) return "7 Cascades Hiking";
  if (t.includes("pieter") || t.includes("both")) return "Pieter Both";
  return null;
};

const parseOperatorDate = (str, selectedYear) => {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  let m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/); // 15th June
  if (!m) m = s.match(/([a-z]+)\s+(\d{1,2})/);             // June 15
  if (!m) return null;
  let day, monStr;
  if (/^\d/.test(m[1])) { day = m[1]; monStr = m[2]; } else { monStr = m[1]; day = m[2]; }
  const mon = MONTHS_MAP[monStr.slice(0, 3)];
  if (mon == null) return null;
  return `${selectedYear}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const parseOperatorBlock = (block, selectedYear) => {
  const lines = block.split("\n").map((l) => l.trim());
  let activity = null;
  for (const l of lines) { const a = matchActivityStrict(l); if (a) { activity = a; break; } }
  // Collect client lines after "Name of client"
  let inClients = false; const clientLines = [];
  for (const l of lines) {
    if (/name of client/i.test(l)) { inClients = true; continue; }
    if (inClients) {
      // Stop collecting at driver/date/note or other trailing fields
      if (/driver|date\s*[:：]|note\s*[:：]/i.test(l)) { inClients = false; continue; }
      const isBullet = /^[-•]/.test(l);
      const cleaned = l.replace(/^[-•\s]+/, "").trim();
      const isAdultChild = /^(adult|child)$/i.test(cleaned) || /\((adult|child)\)/i.test(l);
      // Only count genuine client entries: a bulleted line, or a bare Adult/Child line
      if (cleaned && (isBullet || isAdultChild)) {
        clientLines.push(cleaned);
      }
    }
  }
  const pax = clientLines.length || 1;
  let client = "";
  for (const c of clientLines) {
    const noTag = c.replace(/\((adult|child)\)/i, "").trim();
    if (noTag && !/^(adult|child)$/i.test(noTag)) { client = noTag; break; }
  }
  let dateStr = "";
  for (const l of lines) { const m = l.match(/date\s*[:：]\s*(.+)/i); if (m) { dateStr = m[1]; break; } }
  const date = parseOperatorDate(dateStr, selectedYear);

  // Build a human label so we can tell the user which booking had a problem.
  const label = client || activity || (dateStr ? `(${dateStr.trim()})` : "unnamed booking");

  if (!activity && !date) return null; // not a booking block at all — ignore silently
  if (!activity) return { skipped: true, reason: "no activity recognised", label };
  if (!date) return { skipped: true, reason: dateStr ? `unreadable date "${dateStr.trim()}"` : "no date", label };
  return { activity, pax, client, date };
};

const parseOperatorMulti = (raw, selectedYear) => {
  const lines = raw.split("\n");
  const blocks = []; let cur = [];
  const isHeader = (l) => matchActivityStrict(l) != null && /trip|hik|canyon|climb|tour/i.test(l);
  for (const l of lines) {
    if (isHeader(l) && cur.some((x) => x.trim())) { blocks.push(cur.join("\n")); cur = [l]; }
    else cur.push(l);
  }
  if (cur.some((x) => x.trim())) blocks.push(cur.join("\n"));
  return blocks.map((b) => parseOperatorBlock(b, selectedYear)).filter(Boolean);
};

const expenseTotal = (r) =>
  EXPENSE_CATS.reduce((s, c) => s + Number(r[c.key] || 0), 0);

// Expense total using overridden staff and fuel costs (from day-grouping).
const expenseTotalWith = (r, staffCost, fuelCost) =>
  EXPENSE_CATS.reduce((s, c) => {
    if (c.key === "staff") return s + staffCost;
    if (c.key === "fuel") return s + (fuelCost != null ? fuelCost : Number(r.fuel || 0));
    return s + Number(r[c.key] || 0);
  }, 0);

// Fuel = Rs 700 only if Darryl is on the crew, otherwise Rs 0
const fuelRate = (staffNames) => (staffNames || []).includes("Darryl") ? 700 : 0;

// Effective staff cost for a single booking, given all bookings on its day.
const staffCostFor = (dayBookings, idx) => dayCosts(dayBookings).staff[idx];
// Effective total expense for a booking within its day (grouped staff + fuel).
const effExpense = (dayBookings, idx) => {
  const c = dayCosts(dayBookings);
  return expenseTotalWith(dayBookings[idx], c.staff[idx], c.fuel[idx]);
};

// Income = pax × per-person price
const incomeOf = (r) => (Number(r.pax) || 0) * (Number(r.price) || 0);

// Staff cost = per-activity rate × number of staff on the trip
const staffCostOf = (r) =>
  (r.staffNames ? r.staffNames.length : 0) * staffRate(r.activity, r.pax);

// Which cash account a booking's income lands in.
// Freshverde always pays into the bank (monthly), so its income is bank — never hand.
// Otherwise: Cash → hand, Card/Transfer → bank, Unpaid → receivable.
const incomeAccount = (r) => {
  if (r.source === "Freshverde") return "bank";
  if (r.payment === "Cash") return "hand";
  if (r.payment === "Card" || r.payment === "Transfer") return "bank";
  return null; // Unpaid
};
// Which account a booking's costs are drawn from (defaults to hand).
const costsAccount = (r) => (r.costsFrom === "Bank" ? "bank" : "hand");

// Compute grouped staff AND fuel cost for each booking on a day.
// Same activity + same guide-set (not "assign separately") = ONE trip:
//   - combined pax sets the staff rate, charged once
//   - fuel charged once for the group
// Both costs land on the FIRST booking of the group; others get 0.
// Returns aligned arrays: staff, fuel, lead (is this booking the group's single
// "trip"?), groupPax (combined pax credited to the lead, else this booking's pax).
const dayCosts = (dayBookings) => {
  const staff = new Array(dayBookings.length).fill(0);
  const fuel = new Array(dayBookings.length).fill(0);
  const lead = new Array(dayBookings.length).fill(false);
  const groupPax = dayBookings.map((r) => Number(r.pax) || 0);
  const ov = (r) => (r.staffOverride !== "" && r.staffOverride != null ? Number(r.staffOverride) : null);
  const groups = {};
  dayBookings.forEach((r, i) => {
    const crew = r.staffNames || [];
    if (!crew.length) { fuel[i] = Number(r.fuel) || 0; lead[i] = true; return; } // no guide → its own row
    if (r.separatePay) {
      const o = ov(r);
      staff[i] = o != null ? o : crew.length * staffRate(r.activity, r.pax); // manual override wins
      fuel[i] = fuelRate(crew);
      lead[i] = true;
      return;
    }
    const key = `${r.activity}|${crew.slice().sort().join("|")}`;
    if (!groups[key]) groups[key] = { idxs: [], pax: 0, activity: r.activity, crew, override: null };
    groups[key].idxs.push(i);
    groups[key].pax += Number(r.pax) || 0;
    const o = ov(r);
    if (o != null) groups[key].override = o; // any manual entry sets the whole-group total
  });
  Object.values(groups).forEach((g) => {
    const lead0 = g.idxs[0];
    // Manual override (if entered on any booking in the group) is the group's total
    // staff cost; otherwise auto: combined-pax rate × crew size.
    staff[lead0] = g.override != null ? g.override : g.crew.length * staffRate(g.activity, g.pax);
    fuel[lead0] = fuelRate(g.crew);                              // once
    lead[lead0] = true;
    groupPax[lead0] = g.pax;                                     // combined pax on the lead
    g.idxs.slice(1).forEach((j) => { groupPax[j] = 0; });        // siblings fold into lead
  });
  return { staff, fuel, lead, groupPax };
};

// Staff-only cost per booking (back-compat for existing callers).
const staffCostsForDay = (dayBookings) => dayCosts(dayBookings).staff;

// Guide pay owed for a given day, per guide. Uses grouped staff costs and splits
// each (grouped) booking's staff cost across its crew. Returns { guideName: amount }.
const guidePayForDay = (dayBookings) => {
  const dc = dayCosts(dayBookings);
  const owed = {};
  dayBookings.forEach((r, i) => {
    const crew = r.staffNames || [];
    if (!crew.length || !dc.staff[i]) return;
    const per = dc.staff[i] / crew.length;
    crew.forEach((n) => { owed[n] = (owed[n] || 0) + per; });
  });
  return owed;
};
const guidePayKey = (date, guide) => `${date}|${guide}`;

// ── App (logged-in dashboard; auth handled in main.jsx) ────────────────
export default function TrailLedger({ session }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [reports, setReports] = useState(load); // { "YYYY-MM-DD": [ {...}, ... ] }
  const [sheet, setSheet] = useState(null); // { date, editIndex|null, form }
  const [tab, setTab] = useState("calendar"); // "calendar" | "dashboard" | "cashflow"
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => save(reports), [reports]);

  // Alert dropdown (guide-less bookings) open/closed.
  const [alertOpen, setAlertOpen] = useState(false);
  // Guide-payments dropdown open/closed.
  const [payOpen, setPayOpen] = useState(false);

  // ── Cloud sync (Supabase) ─────────────────────────────────────────────
  // Design rule: NEVER lose bookings. localStorage is the instant offline
  // source; Supabase keeps devices in step. Reconciliation merges the two sets
  // and an empty copy can never overwrite a copy that has data.
  const [syncState, setSyncState] = useState("idle"); // idle|syncing|saved|offline|error
  const hydratedRef = useRef(false);   // true after first cloud reconcile
  const cloudHasDataRef = useRef(false); // true once we know real data exists somewhere
  const pushTimer = useRef(null);

  const pushState = async (rep, set) => {
    if (!session) return false;
    if (!navigator.onLine) { setSyncState("offline"); return false; }
    setSyncState("syncing");
    const stamp = new Date().toISOString();
    try {
      const { error } = await supabase.from("app_state").upsert(
        { user_id: session.user.id, reports: rep, settings: set, updated_at: stamp },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      setStamp(stamp); setSyncState("saved");
      if (countBookings(rep) > 0) cloudHasDataRef.current = true;
      return true;
    } catch {
      setSyncState(navigator.onLine ? "error" : "offline");
      return false;
    }
  };

  // Reconcile on login: merge local + cloud so neither side's bookings are lost.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setSyncState("syncing");
    (async () => {
      try {
        const { data, error } = await supabase
          .from("app_state")
          .select("reports, settings")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;

        const cloudReports = (data && data.reports) || {};
        const cloudSettings = (data && data.settings) || {};

        // Union of local + cloud, de-duplicated. A union can never drop data,
        // so an empty side can't wipe a full one, and duplicates collapse.
        const resolved = mergeReports(reports, cloudReports);
        const resolvedSettings = { ...defaultSettings(), ...cloudSettings, ...settings };

        setReports(resolved); save(resolved);
        setSettings(resolvedSettings); saveSettings(resolvedSettings);
        cloudHasDataRef.current = countBookings(resolved) > 0;
        hydratedRef.current = true;

        // Repair/seed the cloud if our resolved view differs from it.
        if (JSON.stringify(resolved) !== JSON.stringify(cloudReports) ||
            JSON.stringify(resolvedSettings) !== JSON.stringify(cloudSettings)) {
          await pushState(resolved, resolvedSettings);
        } else {
          setSyncState("saved");
        }
      } catch {
        if (!cancelled) setSyncState(navigator.onLine ? "error" : "offline");
        hydratedRef.current = true; // still allow local-only use
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Push on change, debounced. Guard: refuse to push an empty set over a cloud
  // that we know holds data — that was the bug that wiped bookings.
  useEffect(() => {
    if (!session || !hydratedRef.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      if (countBookings(reports) === 0 && cloudHasDataRef.current) {
        setSyncState("saved"); // protect existing cloud data; nothing to push
        return;
      }
      pushState(reports, settings);
    }, 1200);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [reports, settings, session]);

  // Flush when connectivity returns (same empty-guard).
  useEffect(() => {
    const flush = () => {
      if (!session || !hydratedRef.current) return;
      if (countBookings(reports) === 0 && cloudHasDataRef.current) return;
      pushState(reports, settings);
    };
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [session, reports, settings]);

  // Rollups for the selected month
  const monthKeys = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    return Object.keys(reports).filter((k) => k.startsWith(prefix));
  }, [reports, year, month]);

  const stats = useMemo(() => {
    let income = 0, bookings = 0, pax = 0, unpaid = 0, unpaidCount = 0;
    const exp = Object.fromEntries(EXPENSE_CATS.map((c) => [c.key, 0]));
    const byActivity = Object.fromEntries(ACTIVITIES.map((a) => [a, { income: 0, count: 0, pax: 0, expense: 0 }]));
    const byStaff = {};
    const byDay = {}; // day -> bookings count
    const fv = { income: 0, expense: 0, bookings: 0, pax: 0, byActivity: Object.fromEntries(ACTIVITIES.map((a) => [a, { income: 0, count: 0, pax: 0 }])) };
    monthKeys.forEach((k) => {
      const day = Number(k.slice(-2));
      const dayList = reports[k];
      const dc = dayCosts(dayList); // { staff, fuel, lead, groupPax }
      dayList.forEach((r, ri) => {
        bookings++;
        const inc = incomeOf(r);
        income += inc;
        pax += Number(r.pax) || 0;
        const staffCost = dc.staff[ri];
        const fuelCost = dc.fuel[ri];
        const e = expenseTotalWith(r, staffCost, fuelCost);
        // accumulate expense categories with grouped staff + fuel
        EXPENSE_CATS.forEach((c) => {
          if (c.key === "staff") exp[c.key] += staffCost;
          else if (c.key === "fuel") exp[c.key] += fuelCost;
          else exp[c.key] += Number(r[c.key] || 0);
        });
        if (r.payment === "Unpaid") { unpaid += inc; unpaidCount++; }
        if (byActivity[r.activity]) {
          byActivity[r.activity].income += inc;
          byActivity[r.activity].count++;
          byActivity[r.activity].pax += Number(r.pax) || 0;
          byActivity[r.activity].expense += e;
        }
        if (r.source === "Freshverde") {
          fv.income += inc; fv.expense += e; fv.bookings++; fv.pax += Number(r.pax) || 0;
          if (fv.byActivity[r.activity]) { fv.byActivity[r.activity].income += inc; fv.byActivity[r.activity].count++; fv.byActivity[r.activity].pax += Number(r.pax) || 0; }
        }
        const rProfit = inc - e;
        // Guide aggregation: a grouped trip counts ONCE, on the lead booking,
        // with the combined pax. Sibling bookings in the group don't add a trip.
        const crew = r.staffNames || [];
        const isLead = dc.lead[ri];
        const tripPax = dc.groupPax[ri];        // combined pax for the lead, else booking pax
        const perGuidePay = crew.length ? staffCost / crew.length : 0; // staffCost already once-per-group
        crew.forEach((n) => {
          byStaff[n] = byStaff[n] || { trips: 0, pay: 0, revenue: 0, profit: 0, pax: 0, days: new Set(), byActivity: {}, log: [] };
          byStaff[n].pay += perGuidePay;            // pay only on lead (siblings have 0 staffCost)
          byStaff[n].revenue += inc;                // revenue counts every booking
          byStaff[n].profit += rProfit;
          byStaff[n].days.add(day);
          if (isLead) {
            byStaff[n].trips++;                     // count the group as one trip
            byStaff[n].pax += tripPax;              // combined customers on the trip
            byStaff[n].byActivity[r.activity] = (byStaff[n].byActivity[r.activity] || 0) + 1;
            byStaff[n].log.push({ day, activity: r.activity, pax: tripPax, pay: staffCost, client: r.client || "" });
          }
        });
        byDay[day] = (byDay[day] || 0) + 1;
      });
    });
    const totalExp = Object.values(exp).reduce((a, b) => a + b, 0);
    // Convert each guide's day-set to a count (distinct active days)
    Object.values(byStaff).forEach((g) => { g.activeDays = g.days ? g.days.size : 0; delete g.days; });
    const profit = income - totalExp;
    const margin = income ? Math.round((profit / income) * 100) : 0;
    const avgBooking = bookings ? Math.round(income / bookings) : 0;
    const revPerCustomer = pax ? Math.round(income / pax) : 0;
    const fvShare = income ? Math.round((fv.income / income) * 100) : 0;
    let busiestDay = null, busiestCount = 0;
    Object.entries(byDay).forEach(([d, c]) => { if (c > busiestCount) { busiestCount = c; busiestDay = +d; } });
    return { income, bookings, exp, totalExp, profit, margin, pax, avgBooking, revPerCustomer, fvShare,
      unpaid, unpaidCount, byActivity, byStaff, busiestDay, busiestCount,
      fv: { ...fv, profit: fv.income - fv.expense } };
  }, [monthKeys, reports]);

  // Previous month's headline figures, for month-over-month deltas.
  const prevStats = useMemo(() => {
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    const prefix = `${py}-${String(pm + 1).padStart(2, "0")}-`;
    let income = 0, bookings = 0, pax = 0, totalExp = 0;
    Object.keys(reports).filter((k) => k.startsWith(prefix)).forEach((k) => {
      const dl = reports[k]; const dc = dayCosts(dl);
      dl.forEach((r, ri) => {
        income += incomeOf(r); bookings++; pax += Number(r.pax) || 0; totalExp += expenseTotalWith(r, dc.staff[ri], dc.fuel[ri]);
      });
    });
    return { income, bookings, pax, profit: income - totalExp };
  }, [reports, year, month]);

  // Upcoming bookings from today onward (next 30 days), flattened and sorted.
  const upcoming = useMemo(() => {
    const today = todayISO();
    const out = [];
    Object.keys(reports).forEach((date) => {
      if (date >= today) {
        reports[date].forEach((r, idx) => out.push({ date, idx, ...r }));
      }
    });
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out.slice(0, 20);
  }, [reports]);

  // Action Required: any logged booking with no guide assigned — past or
  // upcoming. Past dates are included on purpose: when entering historical
  // data, this surfaces trips that were never properly recorded with a guide.
  const actionRequired = useMemo(() => {
    const out = [];
    Object.keys(reports).forEach((date) => {
      reports[date].forEach((r, idx) => {
        if (!(r.staffNames || []).length) out.push({ date, idx, ...r });
      });
    });
    out.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0)); // newest first
    return out;
  }, [reports]);

  // ── Cash flow analytics ──────────────────────────────────────────────
  const cashflow = useMemo(() => {
    const today = todayISO();
    const monthKey = (d) => d.slice(0, 7);
    const thisMonth = monthKey(today);

    // Net profit per month from all bookings (revenue - costs).
    const monthlyNet = {}; // "YYYY-MM" -> profit
    let receivablesUnpaid = 0, receivablesFreshverde = 0;
    // Cash flows into/out of each account from booking activity (up to & incl. today)
    let handFlow = 0, bankFlow = 0;
    Object.keys(reports).forEach((date) => {
      const mk = monthKey(date);
      const dayList = reports[date];
      const dc = dayCosts(dayList);
      dayList.forEach((r, ri) => {
        const inc = incomeOf(r), exp = expenseTotalWith(r, dc.staff[ri], dc.fuel[ri]);
        monthlyNet[mk] = (monthlyNet[mk] || 0) + (inc - exp);

        const isFV = r.source === "Freshverde";
        // Receivables = money earned but not yet received.
        if (isFV && !r.fvPaid) receivablesFreshverde += inc;   // Freshverde settles monthly
        else if (r.payment === "Unpaid") receivablesUnpaid += inc; // unpaid direct booking

        // Route realised cash flows (only bookings on/before today affect current balances).
        if (date <= today) {
          if (!isFV) {
            const acct = incomeAccount(r); // hand | bank | null(unpaid)
            if (acct === "hand") handFlow += inc;
            else if (acct === "bank") bankFlow += inc;
          }
          // Non-staff costs drain immediately. Staff (guide pay) is handled as a
          // payable below — it only debits the bank when marked paid.
          const nonStaff = exp - dc.staff[ri];
          if (costsAccount(r) === "bank") bankFlow -= nonStaff; else handFlow -= nonStaff;
        }
      });
    });

    // Guide pay payable: sum of unpaid guide-days (up to & incl. today). Paid
    // guide-days have already debited the bank (handled in markGuidePaid).
    const guidePaid = settings.guidePaid || {};
    let guidePayable = 0;
    let bankPaidToGuides = 0;
    Object.keys(reports).forEach((date) => {
      if (date > today) return;
      const owed = guidePayForDay(reports[date]);
      Object.entries(owed).forEach(([guide, amt]) => {
        if (guidePaid[guidePayKey(date, guide)]) bankPaidToGuides += amt; // already paid from bank
        else guidePayable += amt;                                          // still owed
      });
    });
    bankFlow -= bankPaidToGuides; // paid guide wages have left the bank

    // Fixed monthly costs total
    const fixedMonthly = (settings.fixedCosts || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);

    // Burn rate: average monthly cost (booking costs + fixed) over last up-to-3 completed months
    const months = Object.keys(monthlyNet).sort();
    const completed = months.filter((m) => m < thisMonth).slice(-3);
    let avgCostBurn = fixedMonthly;
    if (completed.length) {
      // Recompute average total costs (not net) for burn
      const costByMonth = {};
      Object.keys(reports).forEach((date) => {
        const mk = monthKey(date);
        const dl = reports[date]; const dc = dayCosts(dl);
        dl.forEach((r, ri) => { costByMonth[mk] = (costByMonth[mk] || 0) + expenseTotalWith(r, dc.staff[ri], dc.fuel[ri]); });
      });
      const sum = completed.reduce((s, m) => s + (costByMonth[m] || 0), 0);
      avgCostBurn = sum / completed.length + fixedMonthly;
    }

    // Average monthly revenue (last up-to-3 completed) for forecast
    const revByMonth = {};
    Object.keys(reports).forEach((date) => {
      const mk = monthKey(date);
      reports[date].forEach((r) => { revByMonth[mk] = (revByMonth[mk] || 0) + incomeOf(r); });
    });
    const avgRevenue = completed.length
      ? completed.reduce((s, m) => s + (revByMonth[m] || 0), 0) / completed.length
      : (revByMonth[thisMonth] || 0);

    const bankStart = Number(settings.bankBalance) || 0;
    const handStart = Number(settings.cashInHand) || 0;
    const bank = bankStart + bankFlow;       // current bank = starting + bank flows
    const handCash = handStart + handFlow;   // current cash in hand = starting + hand flows
    const totalCash = bank + handCash;
    const netBurn = avgCostBurn - avgRevenue; // positive = losing cash monthly
    const runwayMonths = netBurn > 0 ? totalCash / netBurn : Infinity;

    // Cash balance trend: last 6 months, total cash (hand + bank), stepping back by monthly net.
    const allMonths = [];
    {
      const d = new Date(today + "T00:00:00");
      for (let i = 5; i >= 0; i--) {
        const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
        allMonths.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}`);
      }
    }
    const trend = [];
    let running = totalCash;
    const futureForecast = [];
    for (let i = allMonths.length - 1; i >= 0; i--) {
      trend[i] = { month: allMonths[i], balance: Math.round(running) };
      running -= (monthlyNet[allMonths[i]] || 0); // step back
    }
    // Forecast next 3 months from total cash + projected net each month
    let fbal = totalCash;
    const projNet = avgRevenue - avgCostBurn;
    const d2 = new Date(today + "T00:00:00");
    for (let i = 1; i <= 3; i++) {
      const dd = new Date(d2.getFullYear(), d2.getMonth() + i, 1);
      fbal += projNet;
      futureForecast.push({ month: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}`, balance: Math.round(fbal) });
    }

    return {
      bank, handCash, totalCash, fixedMonthly, avgCostBurn, avgRevenue, netBurn, runwayMonths,
      receivablesUnpaid, receivablesFreshverde,
      receivablesTotal: receivablesUnpaid + receivablesFreshverde,
      guidePayable,
      trend, futureForecast, projNet,
    };
  }, [reports, settings]);

  const openSheet = (date, editIndex = null) => {
    const existing = editIndex != null ? reports[date][editIndex] : null;
    setSheet({
      date, editIndex,
      form: existing ? { ...existing } : emptyForm(),
      // When editing a saved booking, respect its stored price/food (don't auto-overwrite).
      priceEdited: !!existing, foodEdited: !!existing, staffEdited: !!existing,
    });
  };

  // Parse a forwarded WhatsApp message, jump to its date, open prefilled form.
  const handlePaste = (text) => {
    const { patch, date, matched } = parseWhatsApp(text);
    if (!matched) return { ok: false };
    const targetDate = date || todayISO();
    const [py, pm] = targetDate.split("-").map(Number);
    setYear(py); setMonth(pm - 1);
    setSheet({ date: targetDate, editIndex: null, adding: true,
      form: { ...emptyForm(), ...patch } });
    return { ok: true, date: targetDate };
  };

  // Smart label-free paste: line 1 = activity, line 2 = name, rest by shape.
  // If the activity is recognized AND nothing is missing → save directly (guide
  // assigned later). Otherwise open the form prefilled so gaps can be fixed.
  const handleSmartPaste = (text) => {
    const { patch, date, missing, activityRecognized, matched } = parseSmart(text, year);
    if (!matched) return { ok: false };
    const targetDate = date || todayISO();
    const [py, pm] = targetDate.split("-").map(Number);
    setYear(py); setMonth(pm - 1);

    const complete = activityRecognized && missing.length === 0 && date;
    if (complete) {
      // Insert straight into the calendar — no form. Guide left empty (assign later).
      const clean = { ...emptyForm(), ...patch, pax: Number(patch.pax) || 1, price: Number(patch.price) || 0 };
      setReports((prev) => {
        const next = { ...prev };
        next[targetDate] = next[targetDate] ? [...next[targetDate], clean] : [clean];
        return next;
      });
      return { ok: true, date: targetDate, saved: true };
    }
    // Incomplete → open the form to review/fix before saving.
    setSheet({ date: targetDate, editIndex: null, adding: true,
      form: { ...emptyForm(), ...patch } });
    return { ok: true, date: targetDate, saved: false, missing, activityRecognized };
  };

  // Step the selected month forward/back, rolling the year over at the edges.
  // Moves the whole view (dashboard + calendar) since they share month/year.
  const stepMonth = (delta) => {
    let m = month + delta, y = year;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setMonth(m); setYear(y);
  };

  // Sum of unsettled Freshverde income for a given revenue month "YYYY-MM".
  const freshverdeDueFor = (ym) => {
    let total = 0, count = 0;
    Object.keys(reports).forEach((date) => {
      if (date.slice(0, 7) !== ym) return;
      reports[date].forEach((r) => {
        if (r.source === "Freshverde" && !r.fvPaid) { total += incomeOf(r); count++; }
      });
    });
    return { total, count };
  };

  // Mark a revenue month's Freshverde bookings as paid, and add the received
  // amount to the bank balance. (Freshverde pays ~5th of the following month.)
  const settleFreshverde = (ym, amountReceived) => {
    setReports((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((date) => {
        if (date.slice(0, 7) !== ym) return;
        next[date] = next[date].map((r) =>
          r.source === "Freshverde" && !r.fvPaid ? { ...r, fvPaid: true, fvPaidOn: todayISO() } : r
        );
      });
      return next;
    });
    setSettings((s) => ({
      ...s,
      bankBalance: String((Number(s.bankBalance) || 0) + (Number(amountReceived) || 0)),
      bankAsOf: todayISO(),
    }));
  };

  // Mark a guide as paid for a given day: stamp it and debit the bank by the
  // amount owed (guide wages are paid from the bank).
  const markGuidePaid = (date, guide, amount) => {
    setSettings((s) => ({
      ...s,
      guidePaid: { ...(s.guidePaid || {}), [`${date}|${guide}`]: { paidOn: todayISO(), amount } },
      bankBalance: String((Number(s.bankBalance) || 0) - (Number(amount) || 0)),
      bankAsOf: todayISO(),
    }));
  };
  // Undo a guide payment (refunds the bank).
  const unmarkGuidePaid = (date, guide) => {
    setSettings((s) => {
      const gp = { ...(s.guidePaid || {}) };
      const rec = gp[`${date}|${guide}`];
      delete gp[`${date}|${guide}`];
      const refund = rec && rec.amount ? Number(rec.amount) : 0;
      return { ...s, guidePaid: gp,
        bankBalance: String((Number(s.bankBalance) || 0) + refund), bankAsOf: todayISO() };
    });
  };

  // Pending guide payments: every unpaid guide-day up to today, newest first.
  const pendingGuidePay = useMemo(() => {
    const today = todayISO();
    const paid = settings.guidePaid || {};
    const out = [];
    Object.keys(reports).forEach((date) => {
      if (date > today) return;
      const owed = guidePayForDay(reports[date]);
      Object.entries(owed).forEach(([guide, amount]) => {
        if (!paid[`${date}|${guide}`]) out.push({ date, guide, amount });
      });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out;
  }, [reports, settings]);

  // Build Freshverde invoice line items (one per activity) for a date range.
  const buildInvoice = (fromDate, toDate) => {
    const byAct = {};
    Object.keys(reports).forEach((date) => {
      if (date < fromDate || date > toDate) return;
      reports[date].forEach((r) => {
        if (r.source !== "Freshverde") return;
        const a = r.activity;
        if (!byAct[a]) byAct[a] = { activity: a, pax: 0, revenue: 0 };
        byAct[a].pax += Number(r.pax) || 0;
        byAct[a].revenue += incomeOf(r);
      });
    });
    const lines = Object.values(byAct).map((l) => ({
      ...l, price: l.pax ? Math.round(l.revenue / l.pax) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
    const total = lines.reduce((s, l) => s + l.revenue, 0);
    return { lines, total };
  };

  // Reserve the next invoice number (e.g. OFF26-06) and bump the counter.
  const nextInvoiceNo = () => {
    const yr = String(year).slice(-2);
    const seq = (Number(settings.invoiceSeq) || 0) + 1;
    setSettings((s) => ({ ...s, invoiceSeq: (Number(s.invoiceSeq) || 0) + 1 }));
    return `OFF${yr}-${String(seq).padStart(2, "0")}`;
  };

  // Parse one or many tour-operator messages and insert them directly.
  // Staff is left empty (caters manually); price/food auto-fill. Returns a summary.
  const handleOperatorPaste = (text) => {
    const parsed = parseOperatorMulti(text, year);
    const valid = parsed.filter((p) => !p.skipped);
    const skipped = parsed.filter((p) => p.skipped);
    if (!valid.length) return { ok: false, count: 0, skipped };
    setReports((prev) => {
      const next = { ...prev };
      valid.forEach((p) => {
        const price = priceFor(p.activity, "Freshverde");
        const booking = {
          ...emptyForm(),
          activity: p.activity,
          source: "Freshverde",
          costsFrom: "Bank",
          payment: "Transfer",
          client: p.client || "",
          pax: p.pax,
          price,
          food: String(p.pax * FOOD_PER_PAX),
          fuel: String(fuelRate([])), // 0 until staff added manually
          staff: "", staffNames: [],
          notes: "Imported from Freshverde",
        };
        const list = next[p.date] ? [...next[p.date]] : [];
        list.push(booking);
        next[p.date] = list;
      });
      return next;
    });
    // Jump to the month of the first imported booking
    const [fy, fm] = valid[0].date.split("-").map(Number);
    setYear(fy); setMonth(fm - 1);
    return { ok: true, count: valid.length, skipped };
  };

  const saveReport = () => {
    const { date, editIndex, form } = sheet;
    setReports((prev) => {
      const next = { ...prev };
      const list = next[date] ? [...next[date]] : [];
      const clean = {
        ...form, pax: Number(form.pax) || 1, price: Number(form.price) || 0,
      };
      if (editIndex != null) list[editIndex] = clean;
      else list.push(clean);

      // Group replication: if this booking has guides and isn't "assign separately",
      // copy that guide-set onto all other same-day, same-activity, non-separate
      // bookings (so the whole group shares one guide and one combined day-rate).
      if (!clean.separatePay && (clean.staffNames || []).length) {
        list.forEach((b, i) => {
          if (b === clean) return;
          if (!b.separatePay && b.activity === clean.activity) {
            list[i] = { ...b, staffNames: [...clean.staffNames], fuel: String(fuelRate(clean.staffNames)) };
          }
        });
      }

      next[date] = list;
      return next;
    });
    setSheet(null);
  };

  const deleteReport = () => {
    const { date, editIndex } = sheet;
    setReports((prev) => {
      const next = { ...prev };
      const list = [...next[date]];
      list.splice(editIndex, 1);
      if (list.length) next[date] = list; else delete next[date];
      return next;
    });
    setSheet(null);
  };

  // Wipe everything. Uses an in-app confirm (window.confirm is blocked in some
  // embedded/mobile browsers, which made the button appear to do nothing).
  const clearAll = () => {
    setReports({});
    setSettings(defaultSettings());
    try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(SETTINGS_KEY); } catch {}
  };

  // Download a JSON backup of everything (re-importable).
  const exportBackup = () => {
    const payload = { app: "offline-compass", version: 1, exportedAt: new Date().toISOString(), reports };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `offline-compass-backup-${todayISO()}.json`);
  };

  // Restore from a previously exported JSON backup file.
  const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = data && data.reports ? data.reports : data;
        if (!incoming || typeof incoming !== "object") throw new Error("bad");
        const total = Object.values(incoming).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
        const replace = window.confirm(`Import ${total} booking(s)?\n\nOK = replace everything\nCancel = merge with current data`);
        setReports((prev) => {
          if (replace) return incoming;
          const next = { ...prev };
          Object.keys(incoming).forEach((date) => {
            next[date] = [...(next[date] || []), ...incoming[date]];
          });
          return next;
        });
      } catch {
        window.alert("That file couldn't be read as an Offline Compass backup.");
      }
    };
    reader.readAsText(file);
  };

  // Export the selected month's bookings as a CSV for accounting.
  const exportCSV = () => {
    const rows = [["Date", "Activity", "Source", "Client", "Pax", "Price/person", "Income",
      "Food", "Fuel", "Staff", "Commission", "Total expenses", "Profit", "Payment", "Staff names"]];
    monthKeys.slice().sort().forEach((date) => {
      const dl = reports[date]; const dc = dayCosts(dl);
      dl.forEach((r, ri) => {
        const income = incomeOf(r);
        const staffCost = dc.staff[ri];
        const fuelCost = dc.fuel[ri];
        const exp = expenseTotalWith(r, staffCost, fuelCost);
        rows.push([date, r.activity, r.source || "Direct", r.client || "", r.pax,
          r.price || 0, income, r.food || 0, fuelCost, staffCost, r.commission || 0,
          exp, income - exp, r.payment || "", (r.staffNames || []).join("; ")]);
      });
    });
    if (rows.length === 1) { window.alert("No bookings in this month to export."); return; }
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    downloadBlob(blob, `offline-compass-${year}-${String(month + 1).padStart(2, "0")}.csv`);
  };

  return (
    <div style={S.app}>
      <style>{CSS}</style>
      <Header month={month} year={year} tab={tab} />
      <main style={S.main}>
        <MonthPicker year={year} month={month} setYear={setYear} setMonth={setMonth} />

        {tab === "calendar" ? (
          <>
            {actionRequired.length > 0 && (
              <div style={S.alertWrap}>
                <button style={{ ...S.actionBanner, marginBottom: 0 }} onClick={() => setAlertOpen((o) => !o)}>
                  <span style={S.actionBannerIcon}>⚠</span>
                  <span style={S.actionBannerText}>
                    <strong>{actionRequired.length} booking{actionRequired.length !== 1 ? "s" : ""} need a guide</strong>
                    <span style={S.actionBannerSub}>Tap to choose which one to assign</span>
                  </span>
                  <span style={S.alertChevron}>{alertOpen ? "▲" : "▼"}</span>
                </button>
                {alertOpen && (
                  <div style={S.alertMenu}>
                    {actionRequired.map((b) => (
                      <button
                        key={`${b.date}|${b.idx}`}
                        style={S.alertItem}
                        onClick={() => { setAlertOpen(false); openSheet(b.date, b.idx); }}
                      >
                        <span style={S.alertItemMain}>{fmtShortDate(b.date)} · {b.activity}</span>
                        <span style={S.alertItemSub}>{b.client || "—"} · {b.pax} pax · no guide</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {pendingGuidePay.length > 0 && (
              <div style={S.alertWrap}>
                <button style={{ ...S.payReminder, marginBottom: 0 }} onClick={() => setPayOpen((o) => !o)}>
                  <span style={S.payReminderIcon}>⏰</span>
                  <span style={S.payReminderText}>
                    <strong>{pendingGuidePay.length} guide payment{pendingGuidePay.length !== 1 ? "s" : ""} due</strong>
                    <span style={S.payReminderSub}>Tap to choose a guide to review</span>
                  </span>
                  <span style={S.payReminderAmt}>{fmt(pendingGuidePay.reduce((s, p) => s + p.amount, 0))}</span>
                  <span style={S.alertChevron}>{payOpen ? "▲" : "▼"}</span>
                </button>
                {payOpen && (
                  <div style={S.alertMenu}>
                    {pendingGuidePay.map((p) => (
                      <button
                        key={`${p.date}|${p.guide}`}
                        style={S.alertItem}
                        onClick={() => { setPayOpen(false); setTab("guides"); }}
                      >
                        <span style={S.alertItemMain}>{p.guide} · {fmt(p.amount)}</span>
                        <span style={S.alertItemSub}>{fmtShortDate(p.date)} · tap to review in Guides</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <PasteBar onPaste={handlePaste} onOperatorPaste={handleOperatorPaste} onSmartPaste={handleSmartPaste} />
            <Calendar
              year={year} month={month} reports={reports}
              onPick={(date) => openSheet(date)} onStep={stepMonth}
            />
            <UpcomingList upcoming={upcoming} onOpen={(date, idx) => openSheet(date, idx)} />
          </>
        ) : tab === "dashboard" ? (
          <>
            <CeoOverview stats={stats} prev={prevStats} cf={cashflow} settings={settings} />
            <CashSnapshot cf={cashflow} />
            <ProfitByActivity byActivity={stats.byActivity} />
            <ActivityBreakdown byActivity={stats.byActivity} />
            <FreshverdeSection fv={stats.fv} />
            <Breakdown stats={stats} settings={settings} />
            <DataTools
              onExport={exportBackup} onImport={importBackup}
              onCSV={exportCSV} onClear={clearAll}
            />
            <section style={S.card}>
              <h2 style={S.cardTitle}>Account</h2>
              <p style={S.hint}>
                Signed in as {session.user.email} · {
                  syncState === "saved" ? "All changes synced" :
                  syncState === "syncing" ? "Syncing…" :
                  syncState === "offline" ? "Offline — will sync when back online" :
                  syncState === "error" ? "Sync issue — changes are saved on this device" :
                  "Ready"
                }
              </p>
              <button style={S.signOutBtn} onClick={() => supabase.auth.signOut()}>Sign out</button>
            </section>
          </>
        ) : tab === "cashflow" ? (
          <CashFlow cf={cashflow} settings={settings} setSettings={setSettings}
            freshverdeDueFor={freshverdeDueFor} settleFreshverde={settleFreshverde}
            buildInvoice={buildInvoice} nextInvoiceNo={nextInvoiceNo} year={year} month={month} />
        ) : (
          <GuidesTab byStaff={stats.byStaff} month={month} year={year}
            pending={pendingGuidePay} onMarkPaid={markGuidePaid} onUnmark={unmarkGuidePaid}
            guidePaid={settings.guidePaid || {}} reports={reports} />
        )}
      </main>

      <TabBar tab={tab} setTab={setTab} />

      {tab === "calendar" && (
        <button style={S.fab} onClick={() => openSheet(todayISO())} aria-label="New booking for today">
          + New booking
        </button>
      )}


      {sheet && (
        <Sheet
          sheet={sheet} setSheet={setSheet}
          reports={reports} onSave={saveReport} onDelete={deleteReport}
          onOpenEdit={(i) => openSheet(sheet.date, i)}
        />
      )}
    </div>
  );
}

// ── Bottom tab bar ─────────────────────────────────────────────────────
function TabBar({ tab, setTab }) {
  const tabs = [
    { key: "calendar", label: "Calendar", icon: "▦" },
    { key: "dashboard", label: "Dashboard", icon: "◳" },
    { key: "cashflow", label: "Cash Flow", icon: "₹" },
    { key: "guides", label: "Guides", icon: "◎" },
  ];
  return (
    <nav style={S.tabBar}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => setTab(t.key)}
          style={{ ...S.tabItem, ...(tab === t.key ? S.tabItemOn : {}) }}>
          <span style={S.tabIcon}>{t.icon}</span>
          <span style={S.tabLabel}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── Upcoming bookings list ─────────────────────────────────────────────
function UpcomingList({ upcoming, onOpen }) {
  if (!upcoming.length) {
    return (
      <section style={S.card}>
        <h2 style={S.cardTitle}>Upcoming bookings</h2>
        <p style={S.empty}>No upcoming bookings. Tap a date above to add one.</p>
      </section>
    );
  }
  const fmtDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return { dow: d.toLocaleDateString("en-GB", { weekday: "short" }), day: d.getDate(), mon: d.toLocaleDateString("en-GB", { month: "short" }) };
  };
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Upcoming bookings</h2>
      <div style={S.upList}>
        {upcoming.map((b, i) => {
          const d = fmtDate(b.date);
          return (
            <button key={i} style={S.upRow} onClick={() => onOpen(b.date, b.idx)}>
              <div style={S.upDate}>
                <span style={S.upDay}>{d.day}</span>
                <span style={S.upMon}>{d.mon}</span>
              </div>
              <div style={S.upMid}>
                <div style={S.upActivity}>{b.activity}</div>
                <div style={S.upSub}>{d.dow} · {b.client || "—"} · {b.pax} pax</div>
              </div>
              {!(b.staffNames || []).length && <span style={S.upWarn}>No guide</span>}
              {b.source === "Freshverde" && <span style={S.upBadge}>FV</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Data tools (backup / CSV / clear) ──────────────────────────────────
function DataTools({ onExport, onImport, onCSV, onClear }) {
  const fileRef = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);

  const handleClear = () => {
    if (!confirming) { setConfirming(true); return; }
    onClear();
    setConfirming(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  };

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Data &amp; backup</h2>
      <p style={S.hint}>Your data is saved on this device only. Back it up regularly.</p>
      <div style={S.dataGrid}>
        <button style={S.dataBtn} onClick={onExport}>
          <span style={S.dataBtnTitle}>⤓ Back up</span>
          <span style={S.dataBtnSub}>Save a backup file</span>
        </button>
        <button style={S.dataBtn} onClick={() => fileRef.current && fileRef.current.click()}>
          <span style={S.dataBtnTitle}>⤒ Restore</span>
          <span style={S.dataBtnSub}>Load a backup file</span>
        </button>
        <button style={S.dataBtn} onClick={onCSV}>
          <span style={S.dataBtnTitle}>▤ Export CSV</span>
          <span style={S.dataBtnSub}>This month, for accounts</span>
        </button>
        <button style={{ ...S.dataBtn, ...S.dataBtnDanger, ...(confirming ? S.dataBtnConfirm : {}) }} onClick={handleClear}>
          <span style={{ ...S.dataBtnTitle, color: "#fff" }}>
            {confirming ? "⚠ Tap to confirm" : cleared ? "✓ Cleared" : "⌫ Clear all"}
          </span>
          <span style={{ ...S.dataBtnSub, color: confirming ? "#FECACA" : "#94A3B8" }}>
            {confirming ? "This deletes everything" : "Delete everything"}
          </span>
        </button>
      </div>
      {confirming && (
        <button style={S.clearCancel} onClick={() => setConfirming(false)}>Cancel</button>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; if (f) onImport(f); e.target.value = ""; }} />
    </section>
  );
}

// ── Cash snapshot (compact, shown on Dashboard) ────────────────────────
function CashSnapshot({ cf }) {
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Cash on hand &amp; bank</h2>
      <div style={S.snapRow}>
        <div style={S.snapItem}>
          <span style={S.snapLabel}>In hand</span>
          <span style={S.snapVal}>{fmt(cf.handCash)}</span>
        </div>
        <div style={S.snapDivider} />
        <div style={S.snapItem}>
          <span style={S.snapLabel}>In bank</span>
          <span style={S.snapVal}>{fmt(cf.bank)}</span>
        </div>
        <div style={S.snapDivider} />
        <div style={S.snapItem}>
          <span style={S.snapLabel}>Total</span>
          <span style={{ ...S.snapVal, color: "#2563EB" }}>{fmt(cf.totalCash)}</span>
        </div>
      </div>
    </section>
  );
}

// ── Cash Flow tab ──────────────────────────────────────────────────────
function CashFlow({ cf, settings, setSettings, freshverdeDueFor, settleFreshverde, buildInvoice, nextInvoiceNo, year, month }) {
  const mLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return MONTHS[m - 1].slice(0, 3);
  };
  const runwayText = cf.runwayMonths === Infinity
    ? "Cash-positive"
    : `${cf.runwayMonths.toFixed(1)} months`;
  const runwayColor = cf.runwayMonths === Infinity ? "#16A34A"
    : cf.runwayMonths < 3 ? "#DC2626" : cf.runwayMonths < 6 ? "#D97706" : "#16A34A";

  const histPts = cf.trend.map((t) => ({ label: mLabel(t.month), value: t.balance, forecast: false }));
  const forePts = cf.futureForecast.map((t) => ({ label: mLabel(t.month), value: t.balance, forecast: true }));
  const series = [...histPts, ...forePts];

  return (
    <>
      <section style={S.card}>
        <h2 style={S.cardTitle}>Starting balances</h2>
        <p style={S.hint}>Set these once. Bookings then adjust them automatically as cash moves.</p>
        <label style={S.balLabel}>Cash in bank</label>
        <div style={S.bankRow}>
          <span style={S.bankCur}>Rs</span>
          <input type="number" inputMode="numeric" value={settings.bankBalance}
            onChange={(e) => setSettings((s) => ({ ...s, bankBalance: e.target.value, bankAsOf: todayISO() }))}
            placeholder="0" style={S.bankInput} />
        </div>
        <label style={{ ...S.balLabel, marginTop: 14 }}>Cash in hand</label>
        <div style={S.bankRow}>
          <span style={S.bankCur}>Rs</span>
          <input type="number" inputMode="numeric" value={settings.cashInHand}
            onChange={(e) => setSettings((s) => ({ ...s, cashInHand: e.target.value, cashAsOf: todayISO() }))}
            placeholder="0" style={S.bankInput} />
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Cash position</h2>
        <div style={S.insightGrid}>
          <Insight label="Cash in bank" value={fmt(cf.bank)} sub="incl. card/transfer" />
          <Insight label="Cash in hand" value={fmt(cf.handCash)} sub="incl. cash sales" />
          <Insight label="Total cash" value={fmt(cf.totalCash)} color="#2563EB" />
          <Insight label="Receivables" value={fmt(cf.receivablesTotal)} color="#D97706" sub="owed to you" />
          <Insight label="Guide pay due" value={fmt(cf.guidePayable)} color="#DC2626" sub="wages to pay" />
          <Insight label="Monthly burn" value={fmt(Math.round(cf.avgCostBurn))} color="#DC2626" sub="avg cost / month" />
          <Insight label="Runway" value={runwayText} color={runwayColor}
            sub={cf.runwayMonths === Infinity ? "inflow ≥ outflow" : "at current burn"} />
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Expected receivables</h2>
        <div style={S.recvList}>
          <div style={S.recvRow}>
            <span>Freshverde (pays monthly)</span>
            <strong style={{ color: "#16A34A" }}>{fmt(cf.receivablesFreshverde)}</strong>
          </div>
          <div style={S.recvRow}>
            <span>Unpaid direct bookings</span>
            <strong style={{ color: "#D97706" }}>{fmt(cf.receivablesUnpaid)}</strong>
          </div>
          <div style={{ ...S.recvRow, ...S.recvTotal }}>
            <span>Total expected</span>
            <strong>{fmt(cf.receivablesTotal)}</strong>
          </div>
        </div>
      </section>

      <FreshverdeSettle freshverdeDueFor={freshverdeDueFor} settleFreshverde={settleFreshverde} />

      <InvoiceGenerator buildInvoice={buildInvoice} nextInvoiceNo={nextInvoiceNo}
        settings={settings} year={year} month={month} />

      <section style={S.card}>
        <h2 style={S.cardTitle}>Cash balance — trend &amp; forecast</h2>
        <p style={S.hint}>Solid = past · dashed = projected next 3 months.</p>
        <LineChart series={series} />
        <div style={S.chartLegend}>
          <span><span style={{ ...S.legendDotInline, background: "#2563EB" }} /> Actual</span>
          <span><span style={{ ...S.legendDotInline, background: "#94A3B8" }} /> Forecast</span>
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Monthly outlook</h2>
        <div style={S.insightGrid}>
          <Insight label="Avg revenue" value={fmt(Math.round(cf.avgRevenue))} color="#2563EB" />
          <Insight label="Avg costs" value={fmt(Math.round(cf.avgCostBurn))} color="#DC2626" />
          <Insight label="Net / month" value={fmt(Math.round(cf.projNet))}
            color={cf.projNet < 0 ? "#DC2626" : "#16A34A"}
            sub={cf.projNet < 0 ? "burning cash" : "building cash"} />
          <Insight label="Fixed costs" value={fmt(cf.fixedMonthly)} sub="per month" />
        </div>
      </section>

      <FixedCosts settings={settings} setSettings={setSettings} />
    </>
  );
}

// Mark a revenue month's Freshverde income as received (paid ~5th of next month).
function FreshverdeSettle({ freshverdeDueFor, settleFreshverde }) {
  const now = new Date();
  // Default to the previous month (the one most likely being settled now).
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [ym, setYm] = useState(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
  const due = freshverdeDueFor(ym);
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState("");

  // Build a list of recent months to choose from.
  const monthOpts = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOpts.push({ val: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }

  // Prefill amount with the calculated due whenever the month changes.
  useEffect(() => { setAmount(due.total ? String(due.total) : ""); setDone(""); }, [ym, due.total]);

  const payMonthLabel = (() => {
    const [y, m] = ym.split("-").map(Number);
    const p = new Date(y, m, 5); // 5th of the following month
    return `${p.getDate()} ${MONTHS[p.getMonth()]} ${p.getFullYear()}`;
  })();

  const confirm = () => {
    if (!due.count) return;
    settleFreshverde(ym, Number(amount) || 0);
    setDone(`Marked ${due.count} booking${due.count !== 1 ? "s" : ""} paid · ${fmt(Number(amount) || 0)} added to bank.`);
  };

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Mark Freshverde paid</h2>
      <p style={S.hint}>They pay around the 5th of the next month. Pick the revenue month they settled.</p>
      <label style={S.balLabel}>Revenue month</label>
      <select value={ym} onChange={(e) => setYm(e.target.value)} style={S.input}>
        {monthOpts.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
      </select>

      <div style={S.settleInfo}>
        <div style={S.settleRow}><span>Unsettled bookings</span><strong>{due.count}</strong></div>
        <div style={S.settleRow}><span>Calculated due</span><strong>{fmt(due.total)}</strong></div>
        <div style={S.settleRow}><span>Expected pay date</span><strong>{payMonthLabel}</strong></div>
      </div>

      {due.count > 0 ? (
        <>
          <label style={{ ...S.balLabel, marginTop: 14 }}>Amount received</label>
          <div style={S.bankRow}>
            <span style={S.bankCur}>Rs</span>
            <input type="number" inputMode="numeric" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0" style={S.bankInput} />
          </div>
          <button style={S.settleBtn} onClick={confirm}>Confirm payment received</button>
        </>
      ) : (
        <p style={S.empty}>No unsettled Freshverde bookings for this month.</p>
      )}
      {done && <span style={S.pasteOk}>{done}</span>}
    </section>
  );
}

function LineChart({ series }) {
  if (!series || series.length < 2) {
    return <p style={S.empty}>Not enough data yet to chart. Add bookings and a bank balance.</p>;
  }
  const W = 320, H = 170, PADX = 8, PADY = 14, BASE = 22;
  const vals = series.map((p) => p.value);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const x = (i) => PADX + (i / (series.length - 1)) * (W - PADX * 2);
  const y = (v) => (H - BASE) - ((v - lo) / (hi - lo || 1)) * (H - BASE - PADY);
  const firstForecast = series.findIndex((p) => p.forecast);
  const solid = series.filter((_, i) => firstForecast === -1 || i <= firstForecast);
  const dashed = firstForecast === -1 ? [] : series.slice(Math.max(0, firstForecast - 1));
  const path = (pts, offset) => pts.map((p, i) => `${i ? "L" : "M"}${x(offset + i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {lo < 0 && <line x1={PADX} y1={zeroY} x2={W - PADX} y2={zeroY} stroke="#FCA5A5" strokeWidth="1" strokeDasharray="3 3" />}
      <path d={path(solid, 0)} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinejoin="round" />
      {dashed.length > 1 && (
        <path d={path(dashed, Math.max(0, firstForecast - 1))} fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" />
      )}
      {series.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="2.5" fill={p.forecast ? "#94A3B8" : "#2563EB"} />
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#94A3B8">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function FixedCosts({ settings, setSettings }) {
  const costs = settings.fixedCosts || [];
  const add = () => setSettings((s) => ({ ...s, fixedCosts: [...(s.fixedCosts || []), { name: "", amount: "" }] }));
  const update = (i, key, val) => setSettings((s) => {
    const next = [...s.fixedCosts]; next[i] = { ...next[i], [key]: val };
    return { ...s, fixedCosts: next };
  });
  const remove = (i) => setSettings((s) => {
    const next = [...s.fixedCosts]; next.splice(i, 1);
    return { ...s, fixedCosts: next };
  });
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Fixed monthly costs</h2>
      <p style={S.hint}>Rent, salary, insurance, subscriptions — costs not tied to a trip.</p>
      {costs.map((c, i) => (
        <div key={i} style={S.fcRow}>
          <input value={c.name} onChange={(e) => update(i, "name", e.target.value)}
            placeholder="e.g. Insurance" style={{ ...S.input, flex: 1 }} />
          <input type="number" inputMode="numeric" value={c.amount}
            onChange={(e) => update(i, "amount", e.target.value)} placeholder="0"
            style={{ ...S.input, width: 90 }} />
          <button onClick={() => remove(i)} style={S.fcDel} aria-label="Remove">✕</button>
        </div>
      ))}
      <button onClick={add} style={S.fcAdd}>+ Add fixed cost</button>
    </section>
  );
}

// ── Guides performance tab ─────────────────────────────────────────────
function GuidesTab({ byStaff, month, year, pending = [], onMarkPaid, onUnmark, guidePaid = {}, reports = {} }) {
  const [open, setOpen] = useState(null);
  const guides = Object.entries(byStaff).map(([name, g]) => {
    const revPerTrip = g.trips ? Math.round(g.revenue / g.trips) : 0;
    const profitPerTrip = g.trips ? Math.round(g.profit / g.trips) : 0;
    const valueRatio = g.pay ? (g.revenue / g.pay) : 0; // revenue generated per Rs paid
    const topActivity = Object.entries(g.byActivity || {}).sort((a, b) => b[1] - a[1])[0];
    return { name, ...g, revPerTrip, profitPerTrip, valueRatio, topActivity: topActivity ? topActivity[0] : "—" };
  }).sort((a, b) => b.profit - a.profit);

  const pendingTotal = pending.reduce((s, p) => s + p.amount, 0);
  const fmtDay = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  // Pending payments card renders even when there's no monthly performance data.
  const pendingCard = pending.length > 0 && (
    <section style={{ ...S.card, ...S.payableCard }}>
      <div style={S.payableHead}>
        <h2 style={{ ...S.cardTitle, margin: 0 }}>Guide pay due</h2>
        <span style={S.payableTotal}>{fmt(pendingTotal)}</span>
      </div>
      <p style={S.hint}>Wages owed but not yet paid. Marking paid debits your bank.</p>
      <div style={S.payList}>
        {pending.map((p) => (
          <div key={`${p.date}|${p.guide}`} style={S.duemRow}>
            <div style={S.duemInfo}>
              <span style={S.duemGuide}>{p.guide}</span>
              <span style={S.duemDate}>{fmtDay(p.date)}</span>
            </div>
            <span style={S.duemAmt}>{fmt(p.amount)}</span>
            <button style={S.duemPayBtn} onClick={() => onMarkPaid(p.date, p.guide, p.amount)}>Mark paid</button>
          </div>
        ))}
      </div>
    </section>
  );

  if (!guides.length) {
    return (
      <>
        {pendingCard}
        <section style={S.card}>
          <h2 style={S.cardTitle}>Guide performance</h2>
          <p style={S.empty}>No guide activity this month. Assign staff to bookings to see performance here.</p>
        </section>
      </>
    );
  }

  const totalTrips = guides.reduce((s, g) => s + g.trips, 0);
  const totalRev = guides.reduce((s, g) => s + g.revenue, 0);
  const totalPay = guides.reduce((s, g) => s + g.pay, 0);
  const maxProfit = Math.max(1, ...guides.map((g) => g.profit));
  const active = open ? guides.find((g) => g.name === open) : null;

  return (
    <>
      {pendingCard}
      <section style={S.card}>
        <h2 style={S.cardTitle}>Team summary</h2>
        <div style={S.insightGrid}>
          <Insight label="Active guides" value={guides.length} />
          <Insight label="Trips run" value={totalTrips} />
          <Insight label="Revenue" value={fmt(totalRev)} color="#2563EB" />
          <Insight label="Guide pay" value={fmt(totalPay)} color="#DC2626" sub="total wages" />
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Paid to guides</h2>
        <p style={S.hint}>What the business paid each guide this month.</p>
        <div style={S.payList}>
          {guides.slice().sort((a, b) => b.pay - a.pay).map((g) => (
            <div key={g.name} style={S.payRow}>
              <span style={S.payName}>{g.name}</span>
              <span style={S.payTrips}>{g.trips} trip{g.trips !== 1 ? "s" : ""}</span>
              <span style={S.payAmt}>{fmt(g.pay)}</span>
            </div>
          ))}
        </div>
        <div style={S.payTotal}>
          <span>Total wage bill</span>
          <strong>{fmt(totalPay)}</strong>
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Guides — ranked by profit generated</h2>
        <p style={S.hint}>Each guide is credited the full value of trips they ran. Tap for detail.</p>
        <div style={S.upList}>
          {guides.map((g) => (
            <button key={g.name} style={S.guideRow} onClick={() => setOpen(g.name)}>
              <div style={S.guideTop}>
                <span style={S.guideName}>{g.name}</span>
                <span style={S.guideProfit}>{fmt(g.profit)}</span>
              </div>
              <div style={S.breakBarTrack}>
                <div style={{ ...S.breakBarFill, width: `${(g.profit / maxProfit) * 100}%`, background: "#16A34A" }} />
              </div>
              <div style={S.guideMeta}>
                <span>{g.trips} trip{g.trips !== 1 ? "s" : ""}</span>
                <span>·</span>
                <span>{g.pax} pax</span>
                <span>·</span>
                <span style={{ color: "#DC2626", fontWeight: 600 }}>{fmt(g.pay)} paid</span>
                <span>·</span>
                <span>{fmt(g.revenue)} rev</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section style={S.card}>
        <h2 style={S.cardTitle}>Trips worked this month</h2>
        <p style={S.hint}>Every trip each guide ran, by date.</p>
        {guides.map((g) => (
          <div key={g.name} style={S.gwGuide}>
            <div style={S.gwGuideHead}>
              <span style={S.gwGuideName}>{g.name}</span>
              <span style={S.gwGuideSum}>{g.trips} trip{g.trips !== 1 ? "s" : ""} · {g.pax} pax · {fmt(g.pay)}</span>
            </div>
            <div style={S.gwList}>
              {g.log.slice().sort((a, b) => a.day - b.day).map((t, i) => {
                const dt = new Date(year, month, t.day);
                const dow = dt.toLocaleDateString("en-GB", { weekday: "short" });
                return (
                  <div key={i} style={S.gwRow}>
                    <div style={S.gwDateBox}>
                      <span style={S.gwDow}>{dow}</span>
                      <span style={S.gwDay}>{t.day}</span>
                    </div>
                    <div style={S.gwMid}>
                      <div style={S.gwActivity}>{t.activity}</div>
                      <div style={S.gwSub}>{t.client ? t.client + " · " : ""}{t.pax} pax</div>
                    </div>
                    <div style={S.gwPay}>{t.pay ? fmt(t.pay) : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {active && (
        <div style={S.overlay} onClick={() => setOpen(null)}>
          <div style={S.staffModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.sheetHead}>
              <span style={S.sheetDate}>{active.name}</span>
              <button onClick={() => setOpen(null)} style={S.closeBtn} aria-label="Close">✕</button>
            </div>
            <div style={{ padding: "0 18px 18px" }}>
              <div style={S.insightGrid}>
                <Insight label="Trips" value={active.trips} />
                <Insight label="Customers" value={active.pax} sub="people guided" />
                <Insight label="Active days" value={active.activeDays} />
                <Insight label="Their pay" value={fmt(active.pay)} color="#DC2626" />
                <Insight label="Revenue" value={fmt(active.revenue)} color="#2563EB" />
                <Insight label="Profit" value={fmt(active.profit)} color="#16A34A" />
                <Insight label="Rev / trip" value={fmt(active.revPerTrip)} />
                <Insight label="Value ratio" value={`${active.valueRatio.toFixed(1)}×`} sub="revenue per Rs paid" />
              </div>

              <div style={{ marginTop: 14 }}>
                <span style={S.subhead}>Activity mix</span>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(active.byActivity).sort((a, b) => b[1] - a[1]).map(([act, n]) => {
                    const custs = active.log.filter((t) => t.activity === act).reduce((s, t) => s + t.pax, 0);
                    return (
                      <div key={act} style={S.recvRow}>
                        <span>{act}</span>
                        <strong>{n} trip{n !== 1 ? "s" : ""} · {custs} pax</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <span style={S.subhead}>Trips worked · {active.log.length}</span>
                <div style={S.guideTripList}>
                  {active.log.slice().sort((a, b) => a.day - b.day).map((t, i) => {
                    const dt = new Date(year, month, t.day);
                    const dow = dt.toLocaleDateString("en-GB", { weekday: "short" });
                    return (
                      <div key={i} style={S.guideTripRow}>
                        <div style={S.gtDateBox}>
                          <span style={S.gtDow}>{dow}</span>
                          <span style={S.gtDayNum}>{t.day}</span>
                        </div>
                        <div style={S.gtMid}>
                          <div style={S.gtActivity}>{t.activity}</div>
                          <div style={S.gtSub}>{t.client ? t.client + " · " : ""}{t.pax} pax</div>
                        </div>
                        <div style={S.gtPay}>{t.pay ? fmt(t.pay) : "—"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Freshverde invoice generator ───────────────────────────────────────
function InvoiceGenerator({ buildInvoice, nextInvoiceNo, settings, year, month }) {
  // Default range = the selected month.
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [invoice, setInvoice] = useState(null);
  const [viewing, setViewing] = useState(false);

  const co = settings.company || {};
  const monthLabel = `${MONTHS[month]} ${year}`;

  const generate = () => {
    const { lines, total } = buildInvoice(from, to);
    if (!lines.length) { window.alert("No Freshverde bookings in this date range."); return; }
    const no = nextInvoiceNo();
    const activityLabel = lines.map((l) => l.activity).join(" & ");
    setInvoice({ no, lines, total, date: todayISO(), activityLabel, period: monthLabel });
  };

  const invoiceBody = (inv) => {
    const rows = inv.lines.map((l) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #eee">${l.activity}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center">${l.pax}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">MURs ${l.price.toLocaleString("en-IN")}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right">Rs ${l.revenue.toLocaleString("en-IN")}</td>
      </tr>`).join("");
    return `
  <div style="height:6px;background:#3b3bbf;border-radius:3px;margin-bottom:28px"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <div style="font-size:26px;font-weight:800;color:#6d6df0">${co.name || "OFFLINE Ltd"}</div>
      <div style="color:#555;margin-top:4px">${co.address || ""}</div>
      <div style="color:#555">${co.phone || ""}</div>
    </div>
  </div>
  <h1 style="font-size:40px;color:#1a1a40;margin:28px 0 4px">Invoice</h1>
  <div style="color:#e0218a;font-weight:700;margin-bottom:24px">Invoice Date :: ${inv.date}</div>
  <div style="display:flex;gap:48px;margin-bottom:8px;flex-wrap:wrap">
    <div><div style="font-weight:700">Invoice for</div><div style="color:#555">Freshverde</div></div>
    <div><div style="font-weight:700">Payable to</div><div style="color:#555">${co.name || "OFFLINE Ltd"}</div></div>
    <div><div style="font-weight:700">Invoice #</div><div style="color:#555">${inv.no}</div></div>
  </div>
  <div style="display:flex;gap:48px;margin:16px 0 24px;flex-wrap:wrap">
    <div><div style="font-weight:700">Activity</div><div style="color:#555">${inv.activityLabel}</div></div>
    <div><div style="font-weight:700">Period</div><div style="color:#555">${inv.period}</div></div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-top:8px">
    <thead><tr style="color:#3b3bbf;text-align:left">
      <th style="padding:8px">Description</th><th style="padding:8px;text-align:center">Pax</th>
      <th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Total price</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="text-align:right;font-size:22px;font-weight:800;margin-top:20px">Rs ${inv.total.toLocaleString("en-IN")}</div>
  <div style="margin-top:40px;border-top:1px solid #ccc;padding-top:12px;color:#333;font-size:14px">
    <div style="font-weight:700">Payment Information:</div>
    <div>Account Number: ${co.accNumber || ""}</div>
    <div>Account Name: ${co.accName || ""}</div>
    <div>Bank Name: ${co.bank || ""}</div>
  </div>`;
  };

  const invoiceHTML = (inv) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${inv.no}</title></head>` +
    `<body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;max-width:720px;margin:0 auto;padding:32px">` +
    invoiceBody(inv) + `</body></html>`;

  const printInvoice = () => {
    // Pop-ups are blocked in many mobile/in-app browsers, so print via a hidden
    // iframe instead of window.open — far more reliable.
    try {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(invoiceHTML(invoice));
      doc.close();
      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) { /* fall through to download */ }
          setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 300);
      };
    } catch (e) {
      // If printing isn't available at all, fall back to downloading the file.
      downloadInvoice();
    }
  };

  const downloadInvoice = () => {
    const blob = new Blob([invoiceHTML(invoice)], { type: "text/html" });
    downloadBlob(blob, `invoice-${invoice.no}.html`);
  };

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Freshverde invoice</h2>
      <p style={S.hint}>Generate an invoice for a date range. One line per activity.</p>
      <div style={S.invRange}>
        <div style={{ flex: 1 }}>
          <label style={S.balLabel}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.input} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.balLabel}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.input} />
        </div>
      </div>
      <button style={S.invGenBtn} onClick={generate}>Generate invoice</button>

      {invoice && (
        <div style={S.invPreview}>
          <div style={S.invPreviewHead}>
            <span style={S.invNo}>{invoice.no}</span>
            <span style={S.invDate}>{invoice.date}</span>
          </div>
          <div style={S.invLines}>
            {invoice.lines.map((l, i) => (
              <div key={i} style={S.invLine}>
                <span style={S.invLineAct}>{l.activity}</span>
                <span style={S.invLinePax}>{l.pax} pax</span>
                <span style={S.invLinePrice}>MURs {l.price.toLocaleString("en-IN")}</span>
                <span style={S.invLineTotal}>{fmt(l.revenue)}</span>
              </div>
            ))}
          </div>
          <div style={S.invTotalRow}><span>Total</span><strong>{fmt(invoice.total)}</strong></div>
          <div style={S.invActions}>
            <button style={S.invPrintBtn} onClick={() => setViewing(true)}>View invoice</button>
            <button style={S.invDownloadBtn} onClick={downloadInvoice}>Download</button>
          </div>
        </div>
      )}

      {viewing && invoice && (
        <div style={S.invOverlay}>
          <div style={S.invOverlayBar}>
            <button style={S.invClose} onClick={() => setViewing(false)}>✕ Close</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.invBarBtn} onClick={printInvoice}>Print / PDF</button>
              <button style={S.invBarBtnAlt} onClick={downloadInvoice}>Download</button>
            </div>
          </div>
          <div style={S.invDoc} dangerouslySetInnerHTML={{ __html: invoiceBody(invoice) }} />
        </div>
      )}
    </section>
  );
}

// ── Header ─────────────────────────────────────────────────────────────
function Header({ month, year, tab }) {
  return (
    <header style={S.header}>
      <div style={S.headerRow}>
        <span style={S.logoMark}>◈</span>
        <div style={S.headerText}>
          <span style={S.logo}>Offline <span style={{ color: "#E8743B" }}>Compass</span></span>
          <span style={S.headerSub}>{tab === "calendar" ? "Bookings calendar" : tab === "dashboard" ? "Dashboard" : tab === "cashflow" ? "Cash flow" : "Guide performance"} · {MONTHS[month]} {year}</span>
        </div>
      </div>
    </header>
  );
}

// ── Paste-from-WhatsApp bar ────────────────────────────────────────────
function PasteBar({ onPaste, onOperatorPaste, onSmartPaste }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("smart"); // "smart" | "single" | "operator"
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [skippedList, setSkippedList] = useState([]);

  const submit = () => {
    if (!text.trim()) { setErr("Paste the message first."); return; }
    setErr(""); setOk(""); setSkippedList([]);
    if (mode === "operator") {
      let res;
      try { res = onOperatorPaste(text); }
      catch (e) { setErr("Something went wrong reading those bookings."); return; }
      const skips = (res && res.skipped) || [];
      if (res && res.ok) {
        setText("");
        const skipTxt = skips.length ? `, ${skips.length} skipped` : "";
        setOk(`Imported ${res.count} booking${res.count !== 1 ? "s" : ""}${skipTxt}.`);
        setSkippedList(skips);
      } else {
        setErr("Couldn't import any bookings. Each needs an activity line and a Date.");
        setSkippedList(skips);
      }
      return;
    }
    if (mode === "smart") {
      let res;
      try { res = onSmartPaste(text); }
      catch (e) { setErr("Something went wrong reading that."); return; }
      if (res && res.ok) {
        if (res.saved) {
          // Saved directly — confirm and stay open for the next paste.
          setText("");
          setOk(`Booking saved for ${res.date}. Assign a guide when ready.`);
        } else {
          // Opened the form to fix gaps — close the paste bar.
          setText(""); setOpen(false); setErr("");
        }
      } else {
        setErr("Couldn't read that. First line should be the activity.");
      }
      return;
    }
    let res;
    try { res = onPaste(text); }
    catch (e) { setErr("Something went wrong reading the message."); return; }
    if (res && res.ok) { setText(""); setOpen(false); setErr(""); }
    else setErr("Couldn't read that. It needs lines like \"Hike:\", \"Name:\", \"Date:\".");
  };
  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { setText(t); setErr(""); }
      else setErr("Clipboard looks empty. Copy the message first, or type it below.");
    } catch {
      setErr("Your browser blocked clipboard access. Paste manually into the box below (long-press → Paste).");
    }
  };

  if (!open) {
    return (
      <button style={S.pasteTrigger} onClick={() => setOpen(true)}>
        <span style={S.waMark}>⤵</span> Paste from WhatsApp
      </button>
    );
  }
  const placeholder = mode === "operator"
    ? "Hiking trip to 7 Cascades\nName of client:\n  - Rebecca Allen (Adult)\n  - Adult\nDate: 15th June\n\n(paste several together)"
    : mode === "smart"
    ? "Canyoning\nTarzan\n+230 5789 1234\n3pax\n28th June\n\n(line 1 = activity, line 2 = name, rest in any order)"
    : "Hike: Pieter Both\nNumber of Persons: 1\nDate: 2026-06-20\nName: Andy Cedric";
  return (
    <div style={S.pasteCard}>
      <div style={S.pasteHead}>
        <span style={S.pasteTitle}>Paste booking message</span>
        <button style={S.pasteClose} onClick={() => { setOpen(false); setErr(""); setOk(""); }}>✕</button>
      </div>
      <div style={S.modeRow}>
        <button onClick={() => { setMode("smart"); setErr(""); setOk(""); }}
          style={{ ...S.modeTab, ...(mode === "smart" ? S.modeTabOn : {}) }}>Quick</button>
        <button onClick={() => { setMode("single"); setErr(""); setOk(""); }}
          style={{ ...S.modeTab, ...(mode === "single" ? S.modeTabOn : {}) }}>Labelled</button>
        <button onClick={() => { setMode("operator"); setErr(""); setOk(""); }}
          style={{ ...S.modeTab, ...(mode === "operator" ? S.modeTabOn : {}) }}>Operator</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(""); setOk(""); }}
        placeholder={placeholder}
        style={S.pasteArea}
        rows={6}
      />
      {err && <span style={S.pasteErr}>{err}</span>}
      {ok && <span style={S.pasteOk}>{ok}</span>}
      {skippedList.length > 0 && (
        <div style={S.skipBox}>
          <span style={S.skipTitle}>Skipped ({skippedList.length}) — add these manually:</span>
          {skippedList.map((s, i) => (
            <div key={i} style={S.skipRow}>• {s.label} — {s.reason}</div>
          ))}
        </div>
      )}
      <div style={S.pasteBtns}>
        <button style={S.pasteSecondary} onClick={pasteFromClipboard}>Paste clipboard</button>
        <button style={{ ...S.pastePrimary, ...(text.trim() ? {} : S.pastePrimaryOff) }}
          onClick={submit} disabled={!text.trim()}>
          {mode === "operator" ? "Import all" : "Read & fill"}
        </button>
      </div>
      {mode === "operator" && (
        <p style={S.pasteNote}>Inserts bookings directly (price &amp; food auto-filled). Add staff manually per booking.</p>
      )}
      {mode === "smart" && (
        <p style={S.pasteNote}>Line 1 = activity, line 2 = name. Phone (+), pax (number), and date in any order. If all info is there it saves directly (assign a guide after); if something's missing it opens the form to fix first.</p>
      )}
    </div>
  );
}


function MonthPicker({ year, month, setYear, setMonth }) {
  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2022; y--) years.push(y);
  return (
    <div style={S.pickerRow}>
      <select value={month} onChange={(e) => setMonth(+e.target.value)} style={S.select} aria-label="Month">
        {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
      </select>
      <select value={year} onChange={(e) => setYear(+e.target.value)} style={S.selectSm} aria-label="Year">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

// ── Action Required: confirmed bookings missing a guide ────────────────
function ActionRequired({ items, onOpen }) {
  if (!items.length) return null;
  const fmtDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };
  return (
    <section style={{ ...S.card, ...S.actionCard }}>
      <div style={S.actionHead}>
        <span style={S.actionDot}>⚠</span>
        <h2 style={{ ...S.cardTitle, margin: 0, color: "#B91C1C" }}>Action required</h2>
        <span style={S.actionCount}>{items.length}</span>
      </div>
      <p style={S.hint}>These confirmed bookings have no guide assigned. A trip can't run without one.</p>
      <div style={S.upList}>
        {items.map((b) => (
          <button key={`${b.date}|${b.idx}`} style={S.actionRow} onClick={() => onOpen(b.date, b.idx)}>
            <div style={S.actionRowMid}>
              <div style={S.actionRowActivity}>{b.activity}</div>
              <div style={S.actionRowSub}>{fmtDate(b.date)} · {b.client || "—"} · {b.pax} pax</div>
            </div>
            <span style={S.actionRowTag}>No guide</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── KPIs ───────────────────────────────────────────────────────────────
// ── CEO overview: headline KPIs with month-over-month deltas ───────────
function CeoOverview({ stats, prev, cf, settings }) {
  const delta = (cur, prv) => {
    if (!prv) return null;
    return Math.round(((cur - prv) / Math.abs(prv)) * 100);
  };
  const fixedMonthly = (settings.fixedCosts || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  // Break-even progress: profit before fixed costs vs fixed costs to cover.
  const contribution = stats.profit; // booking-level profit this month
  const breakEvenPct = fixedMonthly > 0 ? Math.round((contribution / fixedMonthly) * 100) : (contribution > 0 ? 100 : 0);

  const tiles = [
    { label: "Profit", value: fmt(stats.profit), d: delta(stats.profit, prev.profit), color: stats.profit < 0 ? "#DC2626" : "#16A34A", good: "up" },
    { label: "Revenue", value: fmt(stats.income), d: delta(stats.income, prev.income), color: "#2563EB", good: "up" },
    { label: "Margin", value: `${stats.margin}%`, sub: "profit / revenue" },
    { label: "Bookings", value: stats.bookings, d: delta(stats.bookings, prev.bookings), good: "up" },
    { label: "Customers", value: stats.pax, d: delta(stats.pax, prev.pax), good: "up" },
    { label: "Rev / customer", value: fmt(stats.revPerCustomer) },
    { label: "Total cash", value: fmt(cf.totalCash), color: "#2563EB" },
    { label: "Runway", value: cf.runwayMonths === Infinity ? "Healthy" : `${cf.runwayMonths.toFixed(1)}m`,
      color: cf.runwayMonths === Infinity ? "#16A34A" : cf.runwayMonths < 3 ? "#DC2626" : "#0F172A" },
    { label: "Freshverde", value: `${stats.fvShare}%`, sub: "of revenue",
      color: stats.fvShare > 60 ? "#D97706" : "#0F172A" },
  ];

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Overview</h2>
      <div style={S.ceoGrid}>
        {tiles.map((t, i) => (
          <div key={i} style={S.ceoTile}>
            <span style={S.ceoLabel}>{t.label}</span>
            <span style={{ ...S.ceoValue, color: t.color || "#0F172A" }}>{t.value}</span>
            {t.d != null ? (
              <span style={{ ...S.ceoDelta, color: deltaColor(t.d, t.good) }}>
                {t.d > 0 ? "▲" : t.d < 0 ? "▼" : "—"} {Math.abs(t.d)}% vs last mo
              </span>
            ) : t.sub ? <span style={S.ceoSub}>{t.sub}</span> : <span style={S.ceoSub}>&nbsp;</span>}
          </div>
        ))}
      </div>
      <div style={S.beBar}>
        <div style={S.beHead}>
          <span>Break-even progress</span>
          <strong style={{ color: breakEvenPct >= 100 ? "#16A34A" : "#D97706" }}>{breakEvenPct}%</strong>
        </div>
        <div style={S.beTrack}>
          <div style={{ ...S.beFill, width: `${Math.max(0, Math.min(100, breakEvenPct))}%`,
            background: breakEvenPct >= 100 ? "#16A34A" : "#D97706" }} />
        </div>
        <span style={S.beNote}>
          {fixedMonthly > 0
            ? `Profit ${fmt(contribution)} vs fixed costs ${fmt(fixedMonthly)}`
            : "Add fixed costs in Cash Flow to track break-even"}
        </span>
      </div>
    </section>
  );
}
// Green when moving the good direction, red otherwise.
function deltaColor(d, good) {
  if (d === 0) return "#94A3B8";
  const up = d > 0;
  const wantUp = good !== "down";
  return (up === wantUp) ? "#16A34A" : "#DC2626";
}

function Kpis({ stats }) {
  return (
    <div style={S.kpiGrid}>
      <Kpi label="Bookings" value={stats.bookings} />
      <Kpi label="Revenue" value={fmt(stats.income)} color="#2563EB" />
      <Kpi label="Cost Generated" value={fmt(stats.totalExp)} color="#DC2626" />
      <Kpi label="Profit" value={fmt(stats.profit)} color={stats.profit < 0 ? "#DC2626" : "#16A34A"} big />
    </div>
  );
}
function Kpi({ label, value, color = "#0F172A", big }) {
  return (
    <div style={{ ...S.kpi, ...(big ? S.kpiBig : {}) }}>
      <span style={S.kpiLabel}>{label}</span>
      <span style={{ ...S.kpiValue, color }}>{value}</span>
    </div>
  );
}

// ── Expense breakdown ──────────────────────────────────────────────────
function Breakdown({ stats, settings }) {
  const { exp, totalExp, income, pax, byActivity } = stats;
  const fixedMonthly = (settings.fixedCosts || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const grandTotal = totalExp + fixedMonthly;

  const costPerCustomer = pax ? Math.round(totalExp / pax) : 0;
  const costRatio = income ? Math.round((totalExp / income) * 100) : 0;

  // Category rows with share of total
  const catColors = { food: "#0EA5E9", fuel: "#F59E0B", staff: "#8B5CF6", commission: "#EC4899" };
  const cats = EXPENSE_CATS.map((c) => ({
    ...c, value: exp[c.key], pct: totalExp ? Math.round((exp[c.key] / totalExp) * 100) : 0,
    color: catColors[c.key] || ORANGE,
  })).sort((a, b) => b.value - a.value);

  // Cost per activity
  const actRows = ACTIVITIES.map((a) => {
    const d = byActivity[a];
    const perCust = d.pax ? Math.round(d.expense / d.pax) : 0;
    return { name: a, expense: d.expense, pax: d.pax, count: d.count, perCust };
  }).filter((r) => r.count > 0).sort((x, y) => y.expense - x.expense);
  const maxAct = Math.max(1, ...actRows.map((r) => r.expense));

  const ratioColor = costRatio > 80 ? "#DC2626" : costRatio > 65 ? "#D97706" : "#16A34A";

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Cost report</h2>

      {/* Headline cost KPIs */}
      <div style={S.insightGrid}>
        <Insight label="Total cost" value={fmt(totalExp)} color="#DC2626" sub="booking costs" />
        <Insight label="Cost / customer" value={fmt(costPerCustomer)} />
        <Insight label="Cost ratio" value={`${costRatio}%`} color={ratioColor} sub="of revenue" />
        <Insight label="+ Fixed costs" value={fmt(fixedMonthly)} sub="monthly overheads" />
      </div>

      {/* Stacked share bar */}
      {totalExp > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={S.subhead}>Where the money goes</span>
          <div style={S.stackBar}>
            {cats.filter((c) => c.value > 0).map((c) => (
              <div key={c.key} style={{ width: `${c.pct}%`, background: c.color, height: "100%" }} title={`${c.label} ${c.pct}%`} />
            ))}
          </div>
          <div style={S.stackLegend}>
            {cats.filter((c) => c.value > 0).map((c) => (
              <span key={c.key} style={S.stackLegItem}>
                <span style={{ ...S.stackDot, background: c.color }} /> {c.label} {c.pct}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Category rows with amount + share */}
      <div style={{ marginTop: 16 }}>
        <span style={S.subhead}>By category</span>
        <div style={{ ...S.breakList, marginTop: 8 }}>
          {cats.map((c) => (
            <div key={c.key} style={S.breakRow}>
              <span style={S.breakLabel}>{c.label}</span>
              <div style={S.breakBarTrack}>
                <div style={{ ...S.breakBarFill, width: `${c.pct}%`, background: c.color, opacity: c.value ? 1 : 0.25 }} />
              </div>
              <span style={S.catVal}>{fmt(c.value)}<span style={S.catPct}>{c.pct}%</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Cost per activity */}
      {actRows.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <span style={S.subhead}>Cost by activity</span>
          <div style={{ ...S.breakList, marginTop: 8 }}>
            {actRows.map((r) => (
              <div key={r.name} style={S.actCostRow}>
                <div style={S.actCostTop}>
                  <span style={S.actName}>{r.name}</span>
                  <span style={S.actVal}>{fmt(r.expense)}</span>
                </div>
                <div style={S.breakBarTrack}>
                  <div style={{ ...S.breakBarFill, width: `${(r.expense / maxAct) * 100}%`, background: "#DC2626" }} />
                </div>
                <div style={S.actCostMeta}>
                  <span>{r.count} booking{r.count !== 1 ? "s" : ""}</span>
                  <span>·</span>
                  <span>{fmt(r.perCust)}/customer</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fixedMonthly > 0 && (
        <div style={S.costTotalRow}>
          <span>Total incl. fixed overheads</span>
          <strong>{fmt(grandTotal)}</strong>
        </div>
      )}
    </section>
  );
}

// ── Insights: margin, pax, unpaid, busiest ─────────────────────────────
function Insights({ stats }) {
  const hasData = stats.bookings > 0;
  if (!hasData) {
    return (
      <section style={S.card}>
        <h2 style={S.cardTitle}>This month at a glance</h2>
        <p style={S.empty}>No bookings yet. Tap a date below to add your first one.</p>
      </section>
    );
  }
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>This month at a glance</h2>
      <div style={S.insightGrid}>
        <Insight label="Profit margin" value={`${stats.margin}%`}
          color={stats.margin < 0 ? "#DC2626" : "#16A34A"}
          sub={stats.margin >= 30 ? "Healthy" : stats.margin >= 0 ? "Thin" : "Loss"} />
        <Insight label="Customers" value={stats.pax}
          sub={`avg ${fmt(stats.avgBooking)}/booking`} />
        <Insight label="Outstanding" value={fmt(stats.unpaid)}
          color={stats.unpaid > 0 ? "#D97706" : "#16A34A"}
          sub={stats.unpaidCount ? `${stats.unpaidCount} unpaid booking${stats.unpaidCount > 1 ? "s" : ""}` : "All paid"} />
        <Insight label="Busiest day" value={stats.busiestDay ? `${stats.busiestDay}` : "—"}
          sub={stats.busiestCount ? `${stats.busiestCount} bookings` : ""} />
      </div>
    </section>
  );
}
function Insight({ label, value, sub, color = "#0F172A" }) {
  return (
    <div style={S.insight}>
      <span style={S.insightLabel}>{label}</span>
      <span style={{ ...S.insightValue, color }}>{value}</span>
      {sub ? <span style={S.insightSub}>{sub}</span> : null}
    </div>
  );
}

// ── Income by activity ─────────────────────────────────────────────────
// ── Profit by activity (the key commercial view) ───────────────────────
function ProfitByActivity({ byActivity }) {
  const rows = ACTIVITIES.map((a) => {
    const d = byActivity[a];
    const profit = d.income - d.expense;
    const margin = d.income ? Math.round((profit / d.income) * 100) : 0;
    const profitPerCust = d.pax ? Math.round(profit / d.pax) : 0;
    return { name: a, ...d, profit, margin, profitPerCust };
  }).filter((r) => r.count > 0).sort((x, y) => y.profit - x.profit);
  if (!rows.length) return null;
  const maxProfit = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Profit by activity</h2>
      <p style={S.hint}>Ranked by profit, not revenue. Margin shows which trips actually pay.</p>
      <div style={S.breakList}>
        {rows.map((r) => {
          const loss = r.profit < 0;
          return (
            <div key={r.name} style={S.pbaRow}>
              <div style={S.actTop}>
                <span style={S.actName}>{r.name}</span>
                <span style={{ ...S.actVal, color: loss ? "#DC2626" : "#16A34A" }}>{fmt(r.profit)}</span>
              </div>
              <div style={S.breakBarTrack}>
                <div style={{ ...S.breakBarFill, width: `${(Math.abs(r.profit) / maxProfit) * 100}%`, background: loss ? "#DC2626" : "#16A34A" }} />
              </div>
              <div style={S.pbaMeta}>
                <span>{r.margin}% margin</span>
                <span>·</span>
                <span>{fmt(r.profitPerCust)}/customer</span>
                <span>·</span>
                <span>{r.count} booking{r.count !== 1 ? "s" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Revenue by activity ────────────────────────────────────────────────
function ActivityBreakdown({ byActivity }) {
  const rows = ACTIVITIES.map((a) => ({ name: a, ...byActivity[a] }))
    .sort((x, y) => y.income - x.income);
  const max = Math.max(1, ...rows.map((r) => r.income));
  const total = rows.reduce((s, r) => s + r.income, 0);
  if (!total) return null;
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Revenue by activity</h2>
      <div style={S.breakList}>
        {rows.map((r) => (
          <div key={r.name} style={S.actRow}>
            <div style={S.actTop}>
              <span style={S.actName}>{r.name}</span>
              <span style={S.actVal}>{fmt(r.income)}</span>
            </div>
            <div style={S.breakBarTrack}>
              <div style={{ ...S.breakBarFill, width: `${(r.income / max) * 100}%`, opacity: r.income ? 1 : 0.2, background: "#2563EB" }} />
            </div>
            <span style={S.actSub}>{r.count} booking{r.count !== 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Freshverde operator section ────────────────────────────────────────
function FreshverdeSection({ fv }) {
  if (!fv || fv.bookings === 0) return null;
  const actRows = ACTIVITIES.map((a) => ({ name: a, ...fv.byActivity[a] }))
    .filter((r) => r.count > 0).sort((a, b) => b.income - a.income);
  const maxAct = Math.max(1, ...actRows.map((r) => r.income));
  return (
    <section style={{ ...S.card, ...S.fvCard }}>
      <div style={S.fvHead}>
        <span style={S.fvBadge}>Freshverde</span>
      </div>
      <div style={S.insightGrid}>
        <Insight label="Bookings" value={fv.bookings} />
        <Insight label="Customers" value={fv.pax} />
        <Insight label="Revenue" value={fmt(fv.income)} color="#2563EB" />
        <Insight label="Profit" value={fmt(fv.profit)} color={fv.profit < 0 ? "#DC2626" : "#16A34A"} />
      </div>
      {actRows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={S.subhead}>By activity</span>
          <div style={{ ...S.breakList, marginTop: 8 }}>
            {actRows.map((r) => (
              <div key={r.name} style={S.actRow}>
                <div style={S.actTop}>
                  <span style={S.actName}>{r.name}</span>
                  <span style={S.actVal}>{fmt(r.income)}</span>
                </div>
                <div style={S.breakBarTrack}>
                  <div style={{ ...S.breakBarFill, width: `${(r.income / maxAct) * 100}%`, background: "#16A34A" }} />
                </div>
                <span style={S.actSub}>{r.count} booking{r.count !== 1 ? "s" : ""} · {r.pax} customer{r.pax !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Staff workload ─────────────────────────────────────────────────────
function StaffSummary({ byStaff, year, month }) {
  const [open, setOpen] = useState(null); // staff name being viewed
  const rows = Object.entries(byStaff).map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.trips - a.trips);
  if (!rows.length) return null;
  const totalPay = rows.reduce((s, r) => s + r.pay, 0);
  const active = open ? rows.find((r) => r.name === open) : null;
  const monthLabel = MONTHS[month];

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Staff this month</h2>
      <div style={S.staffList}>
        {rows.map((r) => (
          <button key={r.name} style={S.staffRowBtn} onClick={() => setOpen(r.name)}>
            <span style={S.staffName}>{r.name}</span>
            <span style={S.staffTrips}>{r.trips} trip{r.trips !== 1 ? "s" : ""}</span>
            <span style={S.staffPay}>{fmt(r.pay)}</span>
            <span style={S.staffChevron}>›</span>
          </button>
        ))}
      </div>
      <div style={S.staffTotal}>
        <span>Total staff cost</span><strong>{fmt(totalPay)}</strong>
      </div>

      {active && (
        <div style={S.overlay} onClick={() => setOpen(null)}>
          <div style={S.staffModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.sheetHead}>
              <span style={S.sheetDate}>{active.name}</span>
              <button onClick={() => setOpen(null)} style={S.closeBtn} aria-label="Close">✕</button>
            </div>
            <div style={S.staffModalSub}>
              {active.trips} trip{active.trips !== 1 ? "s" : ""} in {monthLabel} · {fmt(active.pay)} total
            </div>
            <div style={S.staffLog}>
              {active.log.slice().sort((a, b) => a.day - b.day).map((t, i) => (
                <div key={i} style={S.logRow}>
                  <div style={S.logDate}>{monthLabel.slice(0, 3)} {t.day}</div>
                  <div style={S.logMid}>
                    <div style={S.logActivity}>{t.activity}</div>
                    <div style={S.logSub}>{t.client ? t.client + " · " : ""}{t.pax} pax</div>
                  </div>
                  <div style={S.logPay}>{fmt(t.pay)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


// ── Calendar ───────────────────────────────────────────────────────────
function Calendar({ year, month, reports, onPick, onStep }) {
  const days = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const today = todayISO();

  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>Calendar</h2>
      <p style={S.hint}>Tap any day to log a booking.</p>
      <div style={S.calNav}>
        <button style={S.calNavBtn} onClick={() => onStep(-1)} aria-label="Previous month">‹</button>
        <span style={S.calNavLabel}>{MONTHS[month]} {year}</span>
        <button style={S.calNavBtn} onClick={() => onStep(1)} aria-label="Next month">›</button>
      </div>
      <div style={S.dow}>
        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div style={S.calGrid}>
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const iso = isoFor(year, month, d);
          const dayList = reports[iso] || [];
          const count = dayList.length;
          const isToday = iso === today;
          // Alert day = any day with at least one booking missing a guide
          // (past included, so historical gaps show up too).
          const hasAlert = dayList.some((r) => !(r.staffNames || []).length);
          return (
            <button
              key={i}
              onClick={() => onPick(iso)}
              style={{ ...S.calCell, ...(isToday ? S.calToday : {}), ...(hasAlert ? S.calAlert : {}) }}
            >
              <span>{d}</span>
              {count > 0 && <span style={{ ...S.calBadge, ...(hasAlert ? S.calBadgeAlert : {}) }}>{count}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Bottom sheet: list + form ──────────────────────────────────────────
function Sheet({ sheet, setSheet, reports, onSave, onDelete, onOpenEdit }) {
  const { date, editIndex, form } = sheet;
  const dayReports = reports[date] || [];
  const showingForm = editIndex != null || dayReports.length === 0 || sheet.adding;
  const setForm = (patch) => setSheet((s) => ({ ...s, form: { ...s.form, ...patch } }));

  // Recompute the auto staff amount for a candidate form (rate × crew size),
  // unless the user has manually overridden staff.
  // Changing pax: auto Food (pax × 200) unless overridden. Staff cost is computed
  // live from the grouped rate, so nothing to re-assert here.
  const setPax = (v) => setSheet((s) => {
    const f = { ...s.form, pax: v };
    if (!s.foodEdited) f.food = String((parseInt(v, 10) || 0) * FOOD_PER_PAX);
    return { ...s, form: f };
  });
  const setFood = (v) => setSheet((s) => ({ ...s, foodEdited: true, form: { ...s.form, food: v } }));

  // Picking an activity: auto price (source-aware) unless overridden.
  const setActivity = (v) => setSheet((s) => {
    const f = { ...s.form, activity: v };
    if (!s.priceEdited) f.price = String(priceFor(v, s.form.source));
    return { ...s, form: f };
  });
  const setPrice = (v) => setSheet((s) => ({ ...s, priceEdited: true, form: { ...s.form, price: v } }));
  // Changing the source re-prices the activity (unless price was overridden).
  // Freshverde → costs from bank, payment recorded as Transfer (settled monthly to bank).
  const setSource = (v) => setSheet((s) => {
    const f = { ...s.form, source: v };
    if (!s.priceEdited) f.price = String(priceFor(s.form.activity, v));
    if (v === "Freshverde") { f.costsFrom = "Bank"; f.payment = "Transfer"; }
    else { f.costsFrom = "Hand"; }
    return { ...s, form: f };
  });

  // Toggle a staff name; fuel re-rates from crew. Staff cost is auto (grouped)
  // unless the user types an override into the Staff field.
  const toggleStaff = (name) => setSheet((s) => {
    const cur = s.form.staffNames || [];
    const names = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    const f = { ...s.form, staffNames: names, fuel: String(fuelRate(names)) };
    return { ...s, fuelEdited: false, form: f };
  });
  const setStaff = (v) => setSheet((s) => ({ ...s, form: { ...s.form, staffOverride: v } }));
  const setFuel = (v) => setSheet((s) => ({ ...s, fuelEdited: true, form: { ...s.form, fuel: v } }));

  // Keep price in sync with activity + source unless the user typed a custom price.
  useEffect(() => {
    if (sheet.priceEdited) return;
    const auto = priceFor(form.activity, form.source);
    if (String(auto) !== String(form.price)) {
      setSheet((s) => ({ ...s, form: { ...s.form, price: String(auto) } }));
    }
  }, [form.activity, form.source, sheet.priceEdited]);

  const income = incomeOf(form);
  const profit = income - expenseTotal(form);
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" });

  return (
    <div style={S.overlay} onClick={() => setSheet(null)}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <div>
            <span style={S.sheetDate}>{dateLabel}</span>
          </div>
          <button onClick={() => setSheet(null)} style={S.closeBtn} aria-label="Close">✕</button>
        </div>

        {!showingForm ? (
          <div style={S.sheetBody}>
            {dayReports.map((r, i) => {
              const p = incomeOf(r) - effExpense(dayReports, i);
              const noGuide = !(r.staffNames || []).length;
              return (
                <button key={i} style={{ ...S.reportRow, ...(noGuide ? S.reportRowAlert : {}) }} onClick={() => onOpenEdit(i)}>
                  <div>
                    <div style={S.reportName}>
                      {r.client || r.activity}
                      {noGuide && <span style={S.reportWarnTag}>No guide</span>}
                    </div>
                    <div style={S.reportSub}>{r.activity} · {r.pax} pax · {r.payment}{r.staffNames && r.staffNames.length ? " · " + r.staffNames.join(", ") : ""}</div>
                  </div>
                  <div style={{ ...S.reportProfit, color: noGuide ? "#D97706" : p < 0 ? "#DC2626" : "#16A34A" }}>{fmt(p)}</div>
                </button>
              );
            })}
            <button style={S.primaryBtn} onClick={() => setSheet((s) => ({ ...s, adding: true, form: emptyForm(), priceEdited: false, foodEdited: false, staffEdited: false }))}>
              + Add booking
            </button>
          </div>
        ) : (
          <div style={S.sheetBody}>
            <Field label="Date">
              <input type="date" value={date}
                onChange={(e) => setSheet((s) => ({ ...s, date: e.target.value }))}
                style={S.input} />
            </Field>
            <Field label="Activity">
              <select value={form.activity} onChange={(e) => setActivity(e.target.value)} style={S.input}>
                {ACTIVITIES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <div style={S.chips}>
                {SOURCES.map((src) => (
                  <button key={src} onClick={() => setSource(src)}
                    style={{ ...S.chip, ...(form.source === src ? S.chipOn : {}) }}>{src}</button>
                ))}
              </div>
            </Field>
            <Field label="Client / group name">
              <input value={form.client} onChange={(e) => setForm({ client: e.target.value })}
                placeholder="e.g. Maud's group" style={S.input} />
            </Field>
            <div style={S.row2}>
              <Field label="Pax">
                <input type="number" inputMode="numeric" min="1" value={form.pax}
                  onChange={(e) => setPax(e.target.value)} style={S.input} />
              </Field>
              <Field label="Price / person (Rs)">
                <input type="number" inputMode="numeric" value={form.price}
                  onChange={(e) => setPrice(e.target.value)} placeholder="0" style={S.input} />
              </Field>
            </div>
            <div style={S.incomeBar}>
              <span>Income ({form.pax || 0} × Rs {Number(form.price) || 0})</span>
              <strong style={{ color: "#2563EB" }}>{fmt(income)}</strong>
            </div>
            <div style={S.row2}>
              <Field label="Phone">
                <input type="tel" inputMode="tel" value={form.phone}
                  onChange={(e) => setForm({ phone: e.target.value })} placeholder="—" style={S.input} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.email}
                  onChange={(e) => setForm({ email: e.target.value })} placeholder="—" style={S.input} />
              </Field>
            </div>
            <Field label="Payment">
              {form.source === "Freshverde" ? (
                <div style={S.fvPayNote}>Paid by Freshverde (monthly into bank) — tracked as a receivable.</div>
              ) : (
                <div style={S.chips}>
                  {PAYMENTS.map((p) => (
                    <button key={p} onClick={() => setForm({ payment: p })}
                      style={{ ...S.chip, ...(form.payment === p ? S.chipOn : {}) }}>{p}</button>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Costs paid from">
              <div style={S.chips}>
                {["Hand", "Bank"].map((c) => (
                  <button key={c} onClick={() => setForm({ costsFrom: c })}
                    style={{ ...S.chip, ...(form.costsFrom === c ? S.chipOn : {}) }}>
                    {c === "Hand" ? "Cash in hand" : "Bank"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes">
              <input value={form.notes} onChange={(e) => setForm({ notes: e.target.value })}
                placeholder="e.g. Hike: Pieter Both" style={S.input} />
            </Field>

            <div style={S.divider} />
            <span style={S.subhead}>Staff on this trip</span>
            <div style={S.chips}>
              {STAFF.map((name) => {
                const on = (form.staffNames || []).includes(name);
                return (
                  <button key={name} onClick={() => toggleStaff(name)}
                    style={{ ...S.chip, ...(on ? S.chipOn : {}) }}>{name}</button>
                );
              })}
            </div>
            <label style={S.sepPayRow}>
              <input type="checkbox" checked={!!form.separatePay}
                onChange={(e) => setForm({ separatePay: e.target.checked })} style={S.sepPayCheck} />
              <span>
                <span style={S.sepPayTitle}>Assign separately</span>
                <span style={S.sepPaySub}>Trips of the same activity on the same day with the same guide share one combined day-rate. Tick to take this booking out of the group and pay it on its own.</span>
              </span>
            </label>

            <span style={S.subhead}>Expenses</span>
            <div style={S.expGrid}>
              <Field label="Food & Bev (auto)" small>
                <input type="number" inputMode="numeric" value={form.food}
                  onChange={(e) => setFood(e.target.value)} placeholder="0" style={S.input} />
              </Field>
              <Field label="Fuel (auto)" small>
                <input type="number" inputMode="numeric" value={form.fuel}
                  onChange={(e) => setFuel(e.target.value)} placeholder="0" style={S.input} />
              </Field>
              <Field label="Staff (override)" small>
                <input type="number" inputMode="numeric" value={form.staffOverride}
                  onChange={(e) => setStaff(e.target.value)}
                  placeholder={(form.staffNames || []).length
                    ? `auto ${(form.staffNames || []).length * staffRate(form.activity, form.pax)}`
                    : "0"}
                  style={S.input} />
              </Field>
              <Field label="Commission" small>
                <input type="number" inputMode="numeric" value={form.commission}
                  onChange={(e) => setForm({ commission: e.target.value })} placeholder="0" style={S.input} />
              </Field>
            </div>

            <div style={S.profitBar}>
              <span>Profit</span>
              <strong style={{ color: profit < 0 ? "#DC2626" : "#16A34A" }}>{fmt(profit)}</strong>
            </div>

            <button style={S.primaryBtn} onClick={onSave}>
              {editIndex != null ? "Save changes" : "Add booking"}
            </button>
            {editIndex != null && (
              <button style={S.deleteBtn} onClick={onDelete}>Delete booking</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, small }) {
  return (
    <label style={{ ...S.field, ...(small ? { gap: 3 } : {}) }}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────
const ORANGE = "#E8743B";
const INK = "#0F172A";
const S = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F1F3F5", minHeight: "100vh", color: INK, maxWidth: 480, margin: "0 auto", paddingBottom: 88 },
  header: { padding: "16px 18px", background: "#14202E", position: "sticky", top: 0, zIndex: 5 },
  headerRow: { display: "flex", alignItems: "center", gap: 11 },
  headerText: { display: "flex", flexDirection: "column", gap: 1 },
  logoMark: { color: ORANGE, fontSize: 22, lineHeight: 1 },
  logo: { fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.1 },
  headerSub: { fontSize: 12.5, color: "#94A3B8", fontWeight: 500 },
  main: { padding: "16px 16px 0" },

  tabBar: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: "#fff", borderTop: "1px solid #E2E8F0", boxShadow: "0 -2px 10px rgba(16,24,40,.05)", zIndex: 10, paddingBottom: "env(safe-area-inset-bottom, 0px)" },
  tabItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 0 12px", border: "none", background: "none", cursor: "pointer", color: "#94A3B8" },
  tabItemOn: { color: ORANGE },
  tabIcon: { fontSize: 20, lineHeight: 1 },
  tabLabel: { fontSize: 11.5, fontWeight: 700 },

  upList: { display: "flex", flexDirection: "column", gap: 8 },
  guideRow: { display: "flex", flexDirection: "column", gap: 6, padding: "13px", background: "#F8FAFC", borderRadius: 12, border: "none", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" },
  payList: { display: "flex", flexDirection: "column", gap: 2 },
  payRow: { display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #F1F5F9" },
  payName: { fontSize: 14.5, fontWeight: 600 },
  payTrips: { fontSize: 12.5, color: "#94A3B8" },
  payAmt: { fontSize: 15, fontWeight: 800, color: "#DC2626", minWidth: 78, textAlign: "right" },
  payTotal: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 4, fontSize: 15, fontWeight: 700, color: INK },
  payableCard: { border: "1px solid #FECACA", background: "#FFF7F7" },
  payableHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  payableTotal: { fontSize: 18, fontWeight: 800, color: "#DC2626" },
  duemRow: { display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #FEE2E2" },
  duemInfo: { display: "flex", flexDirection: "column", gap: 1 },
  duemGuide: { fontSize: 14.5, fontWeight: 700 },
  duemDate: { fontSize: 12, color: "#94A3B8" },
  duemAmt: { fontSize: 14.5, fontWeight: 800, color: "#DC2626", minWidth: 66, textAlign: "right" },
  duemPayBtn: { padding: "7px 13px", border: "none", borderRadius: 9, background: "#16A34A", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  payReminder: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 15px", marginBottom: 14, border: "1px solid #FECACA", borderRadius: 14, background: "#FEF2F2", cursor: "pointer", textAlign: "left", font: "inherit" },
  payReminderIcon: { fontSize: 20 },
  payReminderText: { flex: 1, display: "flex", flexDirection: "column", gap: 1, color: "#B91C1C" },
  payReminderSub: { fontSize: 12, color: "#DC2626", fontWeight: 400 },
  payReminderAmt: { fontSize: 16, fontWeight: 800, color: "#DC2626" },
  sepPayRow: { display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", background: "#F8FAFC", borderRadius: 12, cursor: "pointer", marginTop: 4 },
  sepPayCheck: { width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: ORANGE },
  sepPayTitle: { display: "block", fontSize: 14, fontWeight: 600, color: INK },
  sepPaySub: { display: "block", fontSize: 11.5, color: "#94A3B8", marginTop: 2, lineHeight: 1.4 },
  guideTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  guideName: { fontSize: 15, fontWeight: 700 },
  guideProfit: { fontSize: 15, fontWeight: 800, color: "#16A34A" },
  guideMeta: { display: "flex", gap: 6, fontSize: 11.5, color: "#94A3B8", flexWrap: "wrap" },
  gwGuide: { marginTop: 14 },
  gwGuideHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #F1F5F9" },
  gwGuideName: { fontSize: 15, fontWeight: 800 },
  gwGuideSum: { fontSize: 11.5, color: "#94A3B8", fontWeight: 600 },
  gwList: { display: "flex", flexDirection: "column", gap: 7 },
  gwRow: { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12, padding: "9px 11px", background: "#F8FAFC", borderRadius: 11 },
  gwDateBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44, height: 44, background: "#EFF6FF", borderRadius: 10 },
  gwDow: { fontSize: 9.5, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" },
  gwDay: { fontSize: 17, fontWeight: 800, color: "#1D4ED8", lineHeight: 1 },
  gwMid: { minWidth: 0 },
  gwActivity: { fontSize: 14, fontWeight: 600 },
  gwSub: { fontSize: 12, color: "#94A3B8", marginTop: 1 },
  gwPay: { fontSize: 13.5, fontWeight: 700, color: "#DC2626" },
  guideDates: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 },
  guideDateChip: { fontSize: 11, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", padding: "3px 8px", borderRadius: 7 },
  guideTripList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 7 },
  guideTripRow: { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12, padding: "10px 12px", background: "#F8FAFC", borderRadius: 11 },
  gtDate: { fontSize: 12.5, fontWeight: 700, color: "#475569", minWidth: 44 },
  gtDateBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 46, height: 46, background: "#EFF6FF", borderRadius: 10 },
  gtDow: { fontSize: 10, fontWeight: 700, color: "#2563EB", textTransform: "uppercase" },
  gtDayNum: { fontSize: 18, fontWeight: 800, color: "#1D4ED8", lineHeight: 1 },
  gtMid: { minWidth: 0 },
  gtActivity: { fontSize: 14, fontWeight: 600 },
  gtSub: { fontSize: 12, color: "#94A3B8", marginTop: 1 },
  gtPay: { fontSize: 13.5, fontWeight: 700, color: "#DC2626" },
  upRow: { display: "flex", alignItems: "center", gap: 13, padding: "11px 13px", background: "#F8FAFC", borderRadius: 12, border: "none", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" },
  upDate: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44, height: 44, background: "#fff", borderRadius: 10, border: "1px solid #E2E8F0" },
  upDay: { fontSize: 17, fontWeight: 800, lineHeight: 1, color: INK },
  upMon: { fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" },
  upMid: { flex: 1, minWidth: 0 },
  upActivity: { fontSize: 14.5, fontWeight: 700 },
  upSub: { fontSize: 12.5, color: "#64748B", marginTop: 2 },
  upBadge: { fontSize: 10, fontWeight: 800, color: "#15803D", background: "#DCFCE7", padding: "3px 7px", borderRadius: 6, letterSpacing: ".03em" },
  upWarn: { fontSize: 10, fontWeight: 800, color: "#B91C1C", background: "#FEE2E2", padding: "3px 7px", borderRadius: 6, letterSpacing: ".02em" },
  actionCard: { border: "1px solid #FCA5A5", background: "#FEF2F2" },
  actionHead: { display: "flex", alignItems: "center", gap: 8 },
  actionDot: { fontSize: 18 },
  actionCount: { marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#fff", background: "#DC2626", minWidth: 24, height: 24, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 7px" },
  actionRow: { display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", background: "#fff", borderRadius: 12, border: "1px solid #FECACA", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" },
  actionRowMid: { flex: 1, minWidth: 0 },
  actionRowActivity: { fontSize: 14.5, fontWeight: 700 },
  actionRowSub: { fontSize: 12.5, color: "#64748B", marginTop: 2 },
  actionRowTag: { fontSize: 10.5, fontWeight: 800, color: "#B91C1C", background: "#FEE2E2", padding: "4px 8px", borderRadius: 7 },
  actionBanner: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "13px 15px", marginBottom: 14, border: "1px solid #FCA5A5", borderRadius: 14, background: "#FEF2F2", cursor: "pointer", textAlign: "left", font: "inherit" },
  actionBannerIcon: { fontSize: 20, color: "#DC2626" },
  actionBannerText: { flex: 1, display: "flex", flexDirection: "column", gap: 1, color: "#B91C1C" },
  actionBannerSub: { fontSize: 12, color: "#DC2626", fontWeight: 400 },

  // Auth screen
  authWrap: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F1F3F5", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, color: INK },
  authCard: { background: "#fff", width: "100%", maxWidth: 380, borderRadius: 18, padding: "28px 22px", boxShadow: "0 8px 30px rgba(15,23,42,.08)", display: "flex", flexDirection: "column", gap: 14 },
  authBrand: { fontSize: 26, fontWeight: 900, letterSpacing: "0.12em", textAlign: "center", color: INK },
  authHint: { fontSize: 14, color: "#64748B", textAlign: "center", margin: "0 0 4px" },
  authErr: { fontSize: 13, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: "10px 12px" },

  // Guide-less alert dropdown
  alertWrap: { marginBottom: 14, position: "relative" },
  alertChevron: { fontSize: 12, color: "#B91C1C", fontWeight: 700 },
  alertMenu: { marginTop: 6, display: "flex", flexDirection: "column", gap: 6, background: "#fff", border: "1px solid #FCA5A5", borderRadius: 14, padding: 8, boxShadow: "0 6px 20px rgba(185,28,28,.10)", maxHeight: 280, overflowY: "auto" },
  alertItem: { display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "11px 12px", border: "none", borderRadius: 10, background: "#FFF7F7", cursor: "pointer", font: "inherit", width: "100%" },
  alertItemMain: { fontSize: 14, fontWeight: 700, color: "#0F172A" },
  alertItemSub: { fontSize: 12, color: "#B91C1C" },

  signOutBtn: { width: "100%", marginTop: 4, padding: "13px", border: "1px solid #CBD5E1", borderRadius: 13, background: "#fff", color: "#334155", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  dataGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  fab: { position: "fixed", bottom: 78, left: "50%", transform: "translateX(-50%)", zIndex: 9, padding: "13px 22px", border: "none", borderRadius: 26, background: ORANGE, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 14px rgba(232,116,59,.4)" },
  dataBtn: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "13px 14px", border: "1px solid #E2E8F0", borderRadius: 12, background: "#F8FAFC", cursor: "pointer", textAlign: "left", font: "inherit" },
  dataBtnDanger: { borderColor: "#FECACA", background: "#FEF2F2" },
  dataBtnConfirm: { borderColor: "#DC2626", background: "#DC2626" },
  clearCancel: { width: "100%", marginTop: 10, padding: "11px", border: "1px solid #E2E8F0", borderRadius: 11, background: "#fff", fontSize: 14, fontWeight: 600, color: "#475569", cursor: "pointer" },
  dataBtnTitle: { fontSize: 14, fontWeight: 700, color: INK },
  dataBtnSub: { fontSize: 11.5, color: "#94A3B8" },

  pickerRow: { display: "flex", gap: 10, marginBottom: 16 },

  pasteTrigger: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px", marginBottom: 16, border: `1.5px dashed ${ORANGE}`, borderRadius: 13, background: "#FFF6F1", color: ORANGE, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  waMark: { fontSize: 17 },
  pasteCard: { background: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: "0 1px 2px rgba(16,24,40,.05)" },
  pasteHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  pasteTitle: { fontSize: 15, fontWeight: 700 },
  pasteClose: { width: 30, height: 30, borderRadius: 9, border: "none", background: "#F1F5F9", cursor: "pointer", color: "#475569" },
  pasteArea: { width: "100%", boxSizing: "border-box", border: "1px solid #D7DCE1", borderRadius: 11, padding: 12, fontSize: 14, fontFamily: "inherit", resize: "vertical", color: INK },
  pasteErr: { display: "block", color: "#DC2626", fontSize: 13, marginTop: 8 },
  pasteOk: { display: "block", color: "#16A34A", fontSize: 13, fontWeight: 600, marginTop: 8 },
  skipBox: { marginTop: 10, padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10 },
  skipTitle: { display: "block", fontSize: 12.5, fontWeight: 700, color: "#92400E", marginBottom: 6 },
  skipRow: { fontSize: 12.5, color: "#78350F", lineHeight: 1.5 },
  pasteNote: { fontSize: 12, color: "#94A3B8", margin: "10px 0 0", lineHeight: 1.4 },
  modeRow: { display: "flex", gap: 4, padding: 4, background: "#F1F5F9", borderRadius: 10, marginBottom: 10 },
  modeTab: { flex: 1, padding: "8px", border: "none", borderRadius: 7, background: "transparent", fontSize: 13, fontWeight: 600, color: "#64748B", cursor: "pointer" },
  modeTabOn: { background: "#fff", color: "#0F172A", boxShadow: "0 1px 2px rgba(16,24,40,.08)" },
  pasteBtns: { display: "flex", gap: 10, marginTop: 12 },
  pasteSecondary: { flex: 1, padding: "12px", border: "1px solid #D7DCE1", borderRadius: 11, background: "#fff", fontSize: 14, fontWeight: 600, color: "#475569", cursor: "pointer" },
  pastePrimary: { flex: 1, padding: "12px", border: "none", borderRadius: 11, background: ORANGE, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  pastePrimaryOff: { background: "#E2C4B4", cursor: "not-allowed" },

  select: { flex: 2, padding: "12px 14px", border: "1px solid #D7DCE1", borderRadius: 12, fontSize: 16, fontWeight: 600, background: "#fff", color: INK },
  selectSm: { flex: 1, padding: "12px 14px", border: "1px solid #D7DCE1", borderRadius: 12, fontSize: 16, fontWeight: 600, background: "#fff", color: INK },

  kpiGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
  kpi: { background: "#fff", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 1px 2px rgba(16,24,40,.05)" },
  kpiBig: {},
  kpiLabel: { fontSize: 13, color: "#64748B", fontWeight: 500 },
  kpiValue: { fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" },

  card: { background: "#fff", borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: "0 1px 2px rgba(16,24,40,.05)" },
  fvCard: { borderLeft: "4px solid #16A34A" },
  fvHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 },
  fvBadge: { fontSize: 13, fontWeight: 800, letterSpacing: ".03em", color: "#15803D", background: "#DCFCE7", padding: "6px 12px", borderRadius: 8 },
  cardTitle: { fontSize: 17, fontWeight: 700, margin: 0, marginBottom: 14, letterSpacing: "-0.01em" },
  hint: { fontSize: 13, color: "#64748B", margin: "-8px 0 14px" },
  empty: { fontSize: 14, color: "#94A3B8", textAlign: "center", padding: "16px 0" },

  breakList: { display: "flex", flexDirection: "column", gap: 12 },
  breakRow: { display: "grid", gridTemplateColumns: "92px 1fr auto", alignItems: "center", gap: 10 },
  breakLabel: { fontSize: 13, color: "#475569" },
  breakBarTrack: { height: 8, background: "#F1F5F9", borderRadius: 6, overflow: "hidden" },
  breakBarFill: { height: "100%", background: ORANGE, borderRadius: 6, transition: "width .3s" },
  breakVal: { fontSize: 13, fontWeight: 700, minWidth: 64, textAlign: "right" },
  stackBar: { display: "flex", height: 16, borderRadius: 8, overflow: "hidden", marginTop: 8, background: "#F1F5F9" },
  stackLegend: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 },
  stackLegItem: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#475569", fontWeight: 600 },
  stackDot: { width: 9, height: 9, borderRadius: 2, display: "inline-block" },
  catVal: { fontSize: 13, fontWeight: 700, minWidth: 92, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" },
  catPct: { fontSize: 10.5, fontWeight: 600, color: "#94A3B8" },
  actCostRow: { display: "flex", flexDirection: "column", gap: 5 },
  actCostTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  actCostMeta: { display: "flex", gap: 6, fontSize: 11.5, color: "#94A3B8", flexWrap: "wrap" },
  costTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: "1px solid #F1F5F9", fontSize: 15, fontWeight: 700, color: INK },

  insightGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

  ceoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  ceoTile: { display: "flex", flexDirection: "column", gap: 2, padding: "10px 4px" },
  ceoLabel: { fontSize: 11, color: "#64748B", fontWeight: 600 },
  ceoValue: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" },
  ceoDelta: { fontSize: 10.5, fontWeight: 600 },
  ceoSub: { fontSize: 10.5, color: "#94A3B8" },
  beBar: { marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" },
  beHead: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8 },
  beTrack: { height: 9, background: "#F1F5F9", borderRadius: 6, overflow: "hidden" },
  beFill: { height: "100%", borderRadius: 6, transition: "width .3s" },
  beNote: { display: "block", fontSize: 11.5, color: "#94A3B8", marginTop: 6 },

  pbaRow: { display: "flex", flexDirection: "column", gap: 5 },
  pbaMeta: { display: "flex", gap: 6, fontSize: 11.5, color: "#94A3B8", flexWrap: "wrap" },

  bankRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #D7DCE1", borderRadius: 12, padding: "4px 14px", background: "#F8FAFC" },
  balLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#475569", marginBottom: 6 },
  fvPayNote: { fontSize: 13, color: "#15803D", background: "#DCFCE7", padding: "10px 12px", borderRadius: 10, lineHeight: 1.4 },
  invRange: { display: "flex", gap: 10, marginBottom: 12 },
  invGenBtn: { width: "100%", padding: "13px", border: "none", borderRadius: 12, background: "#3b3bbf", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  invPreview: { marginTop: 16, padding: 14, border: "1px solid #E2E8F0", borderRadius: 12, background: "#F8FAFC" },
  invPreviewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  invNo: { fontSize: 15, fontWeight: 800, color: "#3b3bbf" },
  invDate: { fontSize: 12.5, color: "#94A3B8" },
  invLines: { display: "flex", flexDirection: "column", gap: 8 },
  invLine: { display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, alignItems: "baseline", fontSize: 13.5 },
  invLineAct: { fontWeight: 600 },
  invLinePax: { color: "#64748B", fontSize: 12 },
  invLinePrice: { color: "#64748B", fontSize: 12 },
  invLineTotal: { fontWeight: 700, minWidth: 72, textAlign: "right" },
  invTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid #E2E8F0", fontSize: 16, fontWeight: 800 },
  invActions: { display: "flex", gap: 10, marginTop: 14 },
  invPrintBtn: { flex: 1, padding: "12px", border: "none", borderRadius: 11, background: "#16A34A", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  invDownloadBtn: { flex: 1, padding: "12px", border: "1px solid #CBD5E1", borderRadius: 11, background: "#fff", color: "#334155", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  invOverlay: { position: "fixed", inset: 0, background: "#fff", zIndex: 50, display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" },
  invOverlayBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" },
  invClose: { padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 9, background: "#fff", fontSize: 13.5, fontWeight: 600, color: "#334155", cursor: "pointer" },
  invBarBtn: { padding: "8px 12px", border: "none", borderRadius: 9, background: "#16A34A", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  invBarBtnAlt: { padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: 9, background: "#fff", color: "#334155", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  invDoc: { flex: 1, overflow: "auto", padding: "20px 16px", WebkitOverflowScrolling: "touch" },
  settleInfo: { marginTop: 12, padding: "12px 14px", background: "#F8FAFC", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 },
  settleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: "#475569" },
  settleBtn: { width: "100%", marginTop: 14, padding: "14px", border: "none", borderRadius: 13, background: "#16A34A", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  snapRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  snapItem: { display: "flex", flexDirection: "column", gap: 3, flex: 1, alignItems: "center" },
  snapLabel: { fontSize: 12, color: "#64748B", fontWeight: 500 },
  snapVal: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" },
  snapDivider: { width: 1, height: 36, background: "#E2E8F0" },
  bankCur: { fontSize: 18, fontWeight: 700, color: "#64748B" },
  bankInput: { flex: 1, border: "none", background: "transparent", fontSize: 26, fontWeight: 800, padding: "10px 0", color: INK, width: "100%", outline: "none" },
  bankAsOf: { display: "block", fontSize: 12, color: "#94A3B8", marginTop: 8 },

  recvList: { display: "flex", flexDirection: "column", gap: 2 },
  recvRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: "1px solid #F1F5F9", fontSize: 14, color: "#475569" },
  recvTotal: { borderBottom: "none", marginTop: 4, fontSize: 15, fontWeight: 700, color: INK },

  chartLegend: { display: "flex", gap: 18, justifyContent: "center", marginTop: 10, fontSize: 12.5, color: "#64748B" },
  legendDotInline: { width: 9, height: 9, borderRadius: 2, display: "inline-block", marginRight: 5 },

  fcRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  fcDel: { width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 14, cursor: "pointer" },
  fcAdd: { width: "100%", padding: "12px", border: `1.5px dashed ${ORANGE}`, borderRadius: 12, background: "#FFF6F1", color: ORANGE, fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  insight: { background: "#F8FAFC", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2 },
  insightLabel: { fontSize: 12, color: "#64748B", fontWeight: 500 },
  insightValue: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },
  insightSub: { fontSize: 11.5, color: "#94A3B8", fontWeight: 500 },

  actRow: { display: "flex", flexDirection: "column", gap: 5 },
  actTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  actName: { fontSize: 14, fontWeight: 600, color: "#334155" },
  actVal: { fontSize: 14, fontWeight: 800 },
  actSub: { fontSize: 11.5, color: "#94A3B8" },

  staffList: { display: "flex", flexDirection: "column", gap: 2 },
  staffRow: { display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #F1F5F9" },
  staffRowBtn: { display: "grid", gridTemplateColumns: "1fr auto auto 14px", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #F1F5F9", background: "none", border: "none", borderBottomStyle: "solid", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" },
  staffChevron: { color: "#CBD5E1", fontSize: 18, fontWeight: 700 },
  staffModal: { background: "#fff", width: "100%", maxWidth: 480, maxHeight: "80vh", borderRadius: "20px 20px 0 0", display: "flex", flexDirection: "column", animation: "slideUp .25s ease", overflow: "hidden" },
  staffModalSub: { padding: "0 18px 12px", fontSize: 13, color: "#64748B", fontWeight: 500 },
  staffLog: { padding: "0 18px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 },
  logRow: { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 12, padding: "10px 12px", background: "#F8FAFC", borderRadius: 11 },
  logDate: { fontSize: 12.5, fontWeight: 700, color: "#475569", minWidth: 44 },
  logMid: { minWidth: 0 },
  logActivity: { fontSize: 14, fontWeight: 600 },
  logSub: { fontSize: 12, color: "#94A3B8", marginTop: 1 },
  logPay: { fontSize: 14, fontWeight: 700, color: "#16A34A" },
  staffTrips: { fontSize: 13, color: "#64748B" },
  staffName: { fontSize: 14, fontWeight: 600 },
  staffPay: { fontSize: 14, fontWeight: 700, minWidth: 70, textAlign: "right" },
  staffTotal: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 4, fontSize: 14, fontWeight: 700, color: "#334155" },

  calNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 },
  calNavBtn: { width: 40, height: 40, borderRadius: 10, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 22, fontWeight: 700, color: "#475569", cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  calNavLabel: { fontSize: 16, fontWeight: 700, color: "#0F172A" },
  dow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 6 },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  calCell: { position: "relative", aspectRatio: "1", border: "none", background: "#F8FAFC", borderRadius: 10, fontSize: 14, fontWeight: 600, color: INK, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  calToday: { background: "#FFF1E9", boxShadow: `inset 0 0 0 1.5px ${ORANGE}` },
  calAlert: { background: "#FFF7ED", boxShadow: "inset 0 0 0 1.5px #FB923C" },
  calBadge: { position: "absolute", bottom: 4, right: 4, minWidth: 16, height: 16, padding: "0 4px", background: "#16A34A", color: "#fff", borderRadius: 8, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  calBadgeAlert: { background: "#D97706" },

  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 20 },
  sheet: { background: "#fff", width: "100%", maxWidth: 480, maxHeight: "92vh", borderRadius: "20px 20px 0 0", display: "flex", flexDirection: "column", animation: "slideUp .25s ease" },
  sheetHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 12px", borderBottom: "1px solid #F1F5F9" },
  sheetDate: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" },
  closeBtn: { width: 34, height: 34, borderRadius: 10, border: "none", background: "#F1F5F9", fontSize: 15, cursor: "pointer", color: "#475569" },
  sheetBody: { padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 },

  reportRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#F8FAFC", borderRadius: 12, border: "none", textAlign: "left", cursor: "pointer", width: "100%" },
  reportRowAlert: { background: "#FFF7ED", border: "1px solid #FED7AA" },
  reportWarnTag: { marginLeft: 8, fontSize: 10, fontWeight: 800, color: "#B45309", background: "#FEF3C7", padding: "2px 7px", borderRadius: 6, verticalAlign: "middle" },
  reportName: { fontSize: 15, fontWeight: 700 },
  reportSub: { fontSize: 12.5, color: "#64748B", marginTop: 2 },
  reportProfit: { fontSize: 15, fontWeight: 800 },

  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: 600, color: "#475569" },
  input: { padding: "12px 14px", border: "1px solid #D7DCE1", borderRadius: 11, fontSize: 16, background: "#fff", color: INK, width: "100%", boxSizing: "border-box" },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },

  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: { padding: "9px 14px", borderRadius: 20, border: "1px solid #D7DCE1", background: "#fff", fontSize: 14, fontWeight: 600, color: "#475569", cursor: "pointer" },
  chipOn: { background: INK, color: "#fff", borderColor: INK },

  divider: { height: 1, background: "#F1F5F9", margin: "4px 0" },
  subhead: { fontSize: 13, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".04em" },
  expGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },

  incomeBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#EFF6FF", borderRadius: 12, fontSize: 15, fontWeight: 700, marginTop: 2 },
  profitBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#F0FDF4", borderRadius: 12, fontSize: 16, fontWeight: 700, marginTop: 4 },

  primaryBtn: { padding: "15px", border: "none", borderRadius: 13, background: ORANGE, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  deleteBtn: { padding: "13px", border: "none", borderRadius: 13, background: "#FEF2F2", color: "#DC2626", fontSize: 15, fontWeight: 600, cursor: "pointer" },
};

const CSS = `
  * { -webkit-tap-highlight-color: transparent; }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid ${ORANGE}; outline-offset: 2px; }
  input:focus, select:focus { border-color: ${ORANGE}; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;
