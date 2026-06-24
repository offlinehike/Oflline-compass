import { ACTIVITY_PRICE, FRESHVERDE_PRICE } from "./constants";

// Per-person price for an activity given the booking source.
export const priceFor = (activity, source) => {
  const table = source === "Freshverde" ? FRESHVERDE_PRICE : ACTIVITY_PRICE;
  return table[activity] != null ? table[activity] : 0;
};

// Staff pay per staff member, by activity. Some depend on pax (≥4 = higher).
export const staffRate = (activity, pax) => {
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

export const fuelRate = (staffNames) => (staffNames || []).includes("Darryl") ? 700 : 0;

// Income = pax × per-person price
export const incomeOf = (r) => (Number(r.pax) || 0) * (Number(r.price) || 0);

// Staff cost = per-activity rate × number of staff on the trip
export const staffCostOf = (r) =>
  (r.staffNames ? r.staffNames.length : 0) * staffRate(r.activity, r.pax);
