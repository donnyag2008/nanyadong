/**
 * NanyaDong — place matching helpers, shared by chat.js and trip.js
 */

const NAME_STOP = new Set(['rm', 'rumah', 'makan', 'restoran', 'restaurant', 'warung', 'kedai', 'cafe', 'kafe',
  'coffee', 'kopi', 'the', 'dan', 'and', 'di', 'jakarta', 'cabang', 'branch']);

// Words too generic to tell one branch from another
const AREA_STOP = new Set(['kota', 'kab', 'kabupaten', 'jalan', 'raya', 'indonesia', 'jawa', 'barat', 'timur',
  'selatan', 'utara', 'pusat', 'jakarta', 'bekasi', 'bogor', 'depok', 'tangerang', 'banten', 'dki']);

const tokens = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(Boolean);

// Loose name check: at least one meaningful word in common
export function namesMatch(wanted, found) {
  const words = s => tokens(s).filter(w => w.length > 2 && !NAME_STOP.has(w));
  const a = new Set(words(wanted));
  const b = words(found);
  if (a.size === 0) return b.length > 0; // name made only of generic words: trust Google
  return b.some(w => a.has(w));
}

// Distinctive words from the area the model gave (street, kelurahan, landmark)
function areaWords(area) {
  return tokens(area).filter(w => w.length > 3 && !AREA_STOP.has(w));
}

/**
 * From Google's candidates, keep those whose name matches, then prefer the one
 * whose address shares the most distinctive words with the wanted area.
 * Ties keep Google's own ranking. Returns null if no candidate's name matches.
 */
export function pickBest(candidates, name, area) {
  const named = (candidates || []).filter(c => namesMatch(name, (c.displayName && c.displayName.text) || ''));
  if (!named.length) return null;
  const want = areaWords(area);
  if (!want.length) return named[0];

  let best = named[0];
  let bestScore = -1;
  for (const c of named) {
    const addr = `${c.formattedAddress || ''} ${c.shortFormattedAddress || ''}`.toLowerCase();
    const score = want.filter(w => addr.includes(w)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}
