export const EXPENSE_CATS = [
  { key: "food", label: "Food & Bev" },
  { key: "fuel", label: "Fuel" },
  { key: "staff", label: "Staff" },
  { key: "commission", label: "Commission" },
];
export const ACTIVITIES = ["Pieter Both", "7 Cascades Hiking", "Canyoning 7 Cascades", "Le Morne", "Le Pouce"];
export const ACTIVITY_PRICE = {
  "Pieter Both": 4000,
  "7 Cascades Hiking": 2000,
  "Canyoning 7 Cascades": 4000,
  "Le Morne": 2000,
  "Le Pouce": 2000,
}; // per person — direct bookings

// Freshverde operator price list (per person). Pieter Both falls back to direct.
export const FRESHVERDE_PRICE = {
  "Pieter Both": 4000,
  "7 Cascades Hiking": 1500,
  "Canyoning 7 Cascades": 3000,
  "Le Morne": 1500,
  "Le Pouce": 1500,
};

export const SOURCES = ["Direct", "Freshverde"];
export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const PAYMENTS = ["Cash", "Card", "Transfer", "Unpaid"];
export const STAFF = ["Darryl", "Gayan", "Tirou", "Steeve", "Nesta"];

export const STORE_KEY = "trailledger.v1";
export const SETTINGS_KEY = "trailledger.settings.v1";

// Auto-calc rates
export const FOOD_PER_PAX = 200; // Rs per person
