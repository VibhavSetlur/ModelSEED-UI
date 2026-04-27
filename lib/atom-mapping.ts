/**
 * Atom Mapping Loader
 *
 * Loads the static atom_mapping.json bundle (served from /data/atom-mapping/)
 * and exposes helpers to look up atom-map data per reaction ID.
 *
 * The bundle is fetched once and cached — all callers share the same Promise.
 */

/** One entry in the atom-mapping bundle. */
export interface AtomMappingEntry {
  mapped_smiles: string;
  confidence: number;
  rdkit_ready: boolean;
}

/** Shape of the full atom_mapping.json bundle. */
interface AtomMappingBundle {
  generated_at: string;
  source: string;
  mapper: string;
  count: number;
  reactions: Record<string, AtomMappingEntry>;
}

// Singleton promise — one fetch for the lifetime of the page session.
let bundlePromise: Promise<AtomMappingBundle> | null = null;

function loadBundle(): Promise<AtomMappingBundle> {
  if (!bundlePromise) {
    bundlePromise = fetch('/data/atom-mapping/atom_mapping.json', {
      // Next.js will serve this as a static file from /public
      cache: 'force-cache',
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch atom_mapping.json: ${res.status}`);
        return res.json() as Promise<AtomMappingBundle>;
      })
      .catch((err) => {
        // Reset on failure so next call retries.
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

/**
 * Returns the atom-mapping entry for a given reaction ID, or null if not available.
 * Safe to call from a React component via useQuery or useEffect.
 */
export async function getAtomMappingForReaction(
  reactionId: string,
): Promise<AtomMappingEntry | null> {
  try {
    const bundle = await loadBundle();
    return bundle.reactions[reactionId] ?? null;
  } catch {
    return null;
  }
}

// ── Color palette ────────────────────────────────────────────────────────────

/**
 * 20 perceptually distinct, vivid colors for atom-map number → CSS color.
 * These will appear as bond & atom-symbol colors in RDKit SVG (NOT bubble halos).
 * Index 0 is unused (atom-map numbers start at 1).
 */
const ATOM_MAP_PALETTE: readonly string[] = [
  '', // index 0 — unused
  '#e63946', // 1 — vivid red
  '#2a9d8f', // 2 — teal
  '#e9a825', // 3 — amber
  '#3d405b', // 4 — dark indigo
  '#f4722b', // 5 — deep orange
  '#1565c0', // 6 — deep blue
  '#558b2f', // 7 — forest green
  '#7b1fa2', // 8 — purple
  '#00838f', // 9 — dark cyan
  '#d32f2f', // 10 — dark red
  '#0277bd', // 11 — medium blue
  '#37474f', // 12 — blue-grey
  '#4caf50', // 13 — green
  '#ef6c00', // 14 — orange
  '#6a1b9a', // 15 — deep purple
  '#00695c', // 16 — dark teal
  '#c62828', // 17 — crimson
  '#283593', // 18 — indigo
  '#827717', // 19 — dark yellow-green
  '#424242', // 20 — charcoal (fallback for excess atoms)
];

/**
 * Returns a CSS color string for a given atom-map number (1-based).
 * Wraps around the palette for large map numbers.
 */
export function colorForAtomMapNumber(mapNum: number): string {
  if (mapNum <= 0) return ATOM_MAP_PALETTE[20];
  const idx = ((mapNum - 1) % (ATOM_MAP_PALETTE.length - 1)) + 1;
  return ATOM_MAP_PALETTE[idx];
}

// ── SMILES atom-map parser ───────────────────────────────────────────────────

export interface ParsedAtomMapFragment {
  /** 0-based atom indices (within this fragment's SMILES) that carry map labels */
  atomIndices: number[];
  /** Map from 0-based index → atom map number */
  indexToMapNum: Record<number, number>;
  /** Map from 0-based index → CSS color */
  atomColors: Record<number, string>;
}

/**
 * Parse a single SMILES fragment (one compound from the atom-mapped reaction)
 * and return the atom-index → color mapping for RDKit's highlight API.
 *
 * This is done purely in JS by scanning the SMILES string for `:N]` patterns.
 *
 * SMILES atom ordering: each heavy atom token (including those in brackets [X:N])
 * is assigned a sequential 0-based index in the order they appear left-to-right
 * in the SMILES string. Hydrogen atoms implicit in SMILES are NOT counted here.
 *
 * NOTE: This simple parser handles the rxnmapper output format correctly.
 * It does NOT need full SMILES semantics — RDKit itself will parse the SMILES,
 * and we just need to reconcile atom-map numbers with 0-based atom indices.
 */
export function parseAtomMapColors(fragmentSmiles: string): ParsedAtomMapFragment {
  const indexToMapNum: Record<number, number> = {};
  const atomColors: Record<number, string> = {};
  const atomIndices: number[] = [];

  let atomIdx = 0;
  let i = 0;
  const s = fragmentSmiles;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '[') {
      // Bracketed atom: scan until matching ']'
      const start = i;
      i++;
      let mapNum: number | null = null;

      while (i < s.length && s[i] !== ']') {
        // Look for ':N' pattern inside brackets
        if (s[i] === ':') {
          let numStr = '';
          i++;
          while (i < s.length && s[i] >= '0' && s[i] <= '9') {
            numStr += s[i];
            i++;
          }
          if (numStr) mapNum = parseInt(numStr, 10);
          continue;
        }
        i++;
      }
      i++; // skip ']'

      // Extract the element symbol to decide if it's an actual atom
      const bracket = s.substring(start, i);
      // Skip isotope/stereo-only brackets that aren't real atoms —
      // practically all rxnmapper output has real atoms in brackets.
      const elemMatch = bracket.match(/\[(?:\d+)?([A-Za-z]+)/);
      if (elemMatch && elemMatch[1].toLowerCase() !== 'h') {
        if (mapNum !== null) {
          indexToMapNum[atomIdx] = mapNum;
          const color = colorForAtomMapNumber(mapNum);
          atomColors[atomIdx] = color;
          atomIndices.push(atomIdx);
        }
        atomIdx++;
      }
    } else if (ch === '%' || /[A-Z]/.test(ch)) {
      // Unbracketed organic-subset atom (C, N, O, S, P, F, Cl, Br, I, B)
      // Check for two-letter symbols Cl, Br
      const twoChar = s.substring(i, i + 2);
      if (twoChar === 'Cl' || twoChar === 'Br') {
        i += 2;
      } else {
        i++;
      }
      atomIdx++;
    } else if (ch === 'c' || ch === 'n' || ch === 'o' || ch === 's' || ch === 'p') {
      // Aromatic organic subset
      i++;
      atomIdx++;
    } else {
      i++;
    }
  }

  return { atomIndices, indexToMapNum, atomColors };
}

/**
 * Split a reaction SMILES into [reactantFragments, productFragments].
 * Each side is split on '.' (compound separator).
 */
export function splitReactionSmiles(mappedSmiles: string): {
  reactantFrags: string[];
  productFrags: string[];
} {
  const [reactantSide = '', productSide = ''] = mappedSmiles.split('>>');
  return {
    reactantFrags: splitFragments(reactantSide),
    productFrags: splitFragments(productSide),
  };
}

/**
 * Split a SMILES side into individual compound fragments on '.' while
 * respecting ring closure digits and parentheses (doesn't split inside brackets).
 *
 * For rxnmapper output this can be simplified: fragments are separated by '.'
 * that are NOT inside brackets.
 */
function splitFragments(side: string): string[] {
  const frags: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of side) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '[') depth++;
    else if (ch === ']') depth--;

    if (ch === '.' && depth === 0) {
      if (current) frags.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) frags.push(current);
  return frags;
}
