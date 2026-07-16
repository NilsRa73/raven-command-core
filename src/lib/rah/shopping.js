// Shopping — local demo product research surface with shortlist + compare.
// Pure logic + storage layer so Node tests can exercise scoring and compare.

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   category: string,
 *   priceUsd: number,
 *   shippingUsd: number,
 *   supplier: string,
 *   origin: string,          // e.g. "DE", "US"
 *   quality: number,         // 0-100
 *   reviewSummary: string,
 *   compatibility: string[], // ["Windows", "Bridge v0.2+"]
 *   risks: string[],
 *   accent: string,          // gradient key
 * }} Product
 */

export const SHORTLIST_KEY = "rah.shopping.shortlist.v1";

/** Seed catalog — realistic RAH-flavored gear. No external URLs. */
export const CATALOG = [
  { id: "p1", name: "Obsidian Command Deck",       category: "Desk",       priceUsd: 1180, shippingUsd: 80,  supplier: "NorthForge",       origin: "DE", quality: 92, reviewSummary: "Rigid frame, cable trench, matte finish that doesn't glare under gold lamps.",       compatibility: ["Ultrawide", "3× monitor"],                risks: [],                                     accent: "obsidian" },
  { id: "p2", name: "Raven Perch Chair",           category: "Seating",    priceUsd: 640,  shippingUsd: 40,  supplier: "Kildare Ergo",     origin: "IE", quality: 88, reviewSummary: "Firm lumbar, quiet recline, real leather on the head rest.",                          compatibility: ["Standing desks"],                          risks: ["Leather care required"],              accent: "leather" },
  { id: "p3", name: "Antique Gold Task Lamp",      category: "Lighting",   priceUsd: 210,  shippingUsd: 18,  supplier: "Aureus Lighting",  origin: "IT", quality: 84, reviewSummary: "Warm 2700K, dim to a candle, weighty brass arm — feels like a study lamp not an office light.", compatibility: ["Any surface"],                          risks: [],                                     accent: "gold" },
  { id: "p4", name: "Quiet Mesh Router",           category: "Network",    priceUsd: 320,  shippingUsd: 12,  supplier: "Meshcraft",        origin: "US", quality: 79, reviewSummary: "Steady mesh, weak app; put it on a shelf and forget it.",                             compatibility: ["Bridge v0.2+"],                             risks: ["App requires cloud account"],         accent: "steel" },
  { id: "p5", name: "Studio-Grade Mic Boom",       category: "Audio",      priceUsd: 280,  shippingUsd: 22,  supplier: "Aureus Audio",     origin: "SE", quality: 91, reviewSummary: "Silent swivel, holds a heavy condenser, no droop after months.",                       compatibility: ["USB and XLR mics"],                         risks: [],                                     accent: "obsidian" },
  { id: "p6", name: "Home Mesh Hub — Local Only",  category: "Home Mesh",  priceUsd: 190,  shippingUsd: 10,  supplier: "Hjemsted",         origin: "NO", quality: 86, reviewSummary: "Runs fully local, no cloud lock-in, Zigbee + Matter, matches Raven Bridge model.",     compatibility: ["Bridge v0.2+", "Zigbee", "Matter"],         risks: [],                                     accent: "gold" },
  { id: "p7", name: "Warm Wall Sconce Pair",       category: "Lighting",   priceUsd: 145,  shippingUsd: 15,  supplier: "Aureus Lighting",  origin: "IT", quality: 82, reviewSummary: "Cast bronze, warm CRI 95 bulbs included, no bright LED cold spot.",                   compatibility: ["Standard E27"],                             risks: [],                                     accent: "leather" },
  { id: "p8", name: "Ergonomic Standing Mat",      category: "Seating",    priceUsd: 95,   shippingUsd: 10,  supplier: "Kildare Ergo",     origin: "IE", quality: 74, reviewSummary: "Solid but shows scuffs after a month — dark colour saves you.",                        compatibility: ["Standing desks"],                          risks: ["Marks show on light floors"],         accent: "steel" },
  { id: "p9", name: "3× Monitor Riser (Walnut)",   category: "Desk",       priceUsd: 260,  shippingUsd: 25,  supplier: "NorthForge",       origin: "DE", quality: 88, reviewSummary: "Real walnut top, rock steady with three 27\" panels, hidden cable channel.",           compatibility: ["Ultrawide + side monitors"],                risks: [],                                     accent: "leather" },
  { id: "p10",name: "Silent Mechanical Keyboard",  category: "Audio",      priceUsd: 175,  shippingUsd: 12,  supplier: "Quietworks",       origin: "TW", quality: 81, reviewSummary: "Truly quiet under a mic; typing feel is soft not clacky.",                             compatibility: ["Windows", "macOS"],                         risks: [],                                     accent: "obsidian" },
  { id: "p11",name: "Quest 3 Cushion Kit",         category: "VR",         priceUsd: 55,   shippingUsd: 8,   supplier: "Halo Gear",        origin: "US", quality: 76, reviewSummary: "Way better than the stock strap; longer sessions become possible.",                    compatibility: ["Quest 3"],                                  risks: ["No official warranty"],               accent: "gold" },
  { id: "p12",name: "Warm Rug 2×3m",               category: "Environment",priceUsd: 420,  shippingUsd: 45,  supplier: "Hjemsted",         origin: "NO", quality: 83, reviewSummary: "Soft, warm underfoot, calms hard floors in the office.",                              compatibility: ["Any floor"],                                risks: ["Vacuum on low"],                      accent: "leather" },
];

/** Landed cost = price + shipping, rounded to nearest dollar. */
export function landedCost(p) {
  return Math.round(Number(p.priceUsd || 0) + Number(p.shippingUsd || 0));
}

/** Score risks with a soft penalty. Returns 0-100. */
export function adjustedQuality(p) {
  const base = Math.max(0, Math.min(100, Number(p.quality || 0)));
  const penalty = Math.min(20, (p.risks?.length ?? 0) * 6);
  return Math.max(0, base - penalty);
}

/** Sort catalog with basic filtering. */
export function filterCatalog(list, query, category) {
  const q = String(query ?? "").trim().toLowerCase();
  return list.filter((p) => {
    if (category && category !== "All" && p.category !== category) return false;
    if (!q) return true;
    const hay = [p.name, p.category, p.supplier, p.origin, p.reviewSummary, ...(p.compatibility || [])].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** Compare 2–4 products across a fixed set of fields. */
export function buildComparison(products) {
  if (!Array.isArray(products) || products.length < 2) throw new Error("compare: need at least 2 products");
  if (products.length > 4) throw new Error("compare: at most 4 products");
  return {
    fields: ["priceUsd", "shippingUsd", "landed", "quality", "adjusted", "origin", "supplier"],
    rows: products.map((p) => ({
      id: p.id, name: p.name,
      priceUsd: p.priceUsd, shippingUsd: p.shippingUsd,
      landed: landedCost(p), quality: p.quality,
      adjusted: adjustedQuality(p),
      origin: p.origin, supplier: p.supplier,
      risks: p.risks || [], compatibility: p.compatibility || [],
    })),
  };
}

export function loadShortlist() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SHORTLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveShortlist(ids) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

export function toggleShortlist(id) {
  const cur = loadShortlist();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  saveShortlist(next);
  return next;
}
