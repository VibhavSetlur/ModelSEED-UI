'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Chip from '@mui/material/Chip';
import {
  getAtomMappingForReaction,
  parseAtomMapColors,
  splitReactionSmiles,
  colorForAtomMapNumber,
} from '@/lib/atom-mapping';
import { getCompoundsForReaction } from '@/lib/api/biochem';
import type { AtomColors } from './MoleculeRenderer';

const MoleculeRenderer = dynamic(() => import('./MoleculeRenderer'), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" width={150} height={150} sx={{ borderRadius: 1 }} />,
});

/* ─── Types ──────────────────────────────────────────────────── */

interface CompoundToken {
  id: string;
  stoich: string;
}

interface ParsedEquation {
  reactants: CompoundToken[];
  products: CompoundToken[];
  arrow: string;
}

interface AtomMappedReactionProps {
  reactionId: string;
  equation?: string;
  reversibility?: string;
}

/* ─── Equation Parser ────────────────────────────────────────── */

function parseEquation(eq: string): ParsedEquation {
  let arrow = '⇒';
  let lhs = eq;
  let rhs = '';
  if (eq.includes('<=>')) { arrow = '⇌'; [lhs, rhs] = eq.split('<=>'); }
  else if (eq.includes('=>')) { arrow = '⇒'; [lhs, rhs] = eq.split('=>'); }
  else if (eq.includes('<=')) { arrow = '⇐'; [lhs, rhs] = eq.split('<='); }
  return { reactants: parseSide(lhs ?? ''), products: parseSide(rhs ?? ''), arrow };
}

function parseSide(side: string): CompoundToken[] {
  return side.split('+').map((t) => t.trim()).filter(Boolean).map((token) => {
    const cleaned = token.replace(/\[\w+\]/g, '').trim();
    const stoichMatch = cleaned.match(/^\(?([\d.]+)\)?\s*/);
    const stoich = stoichMatch && stoichMatch[1] !== '1' ? stoichMatch[1] : '';
    const rest = cleaned.replace(/^\(?([\d.]+)\)?\s*/, '').trim();
    const idMatch = rest.match(/cpd\d{5}/);
    return { id: idMatch ? idMatch[0] : rest, stoich };
  }).filter((t) => t.id.startsWith('cpd'));
}

/* ─── Atom Legend ────────────────────────────────────────────── */

function AtomMapLegend({ mappedSmiles }: { mappedSmiles: string }) {
  const legend = useMemo(() => {
    const pairs: Array<{ mapNum: number; color: string }> = [];
    const seen = new Set<number>();
    const allFrags = mappedSmiles.replace('>>', '.').split('.');
    for (const frag of allFrags) {
      const parsed = parseAtomMapColors(frag);
      for (const [, mapNum] of Object.entries(parsed.indexToMapNum)) {
        if (!seen.has(mapNum)) {
          seen.add(mapNum);
          pairs.push({ mapNum, color: colorForAtomMapNumber(mapNum) });
        }
      }
    }
    return pairs.sort((a, b) => a.mapNum - b.mapNum).slice(0, 20);
  }, [mappedSmiles]);

  if (legend.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
      {legend.map(({ mapNum, color }) => (
        <Box
          key={mapNum}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.4,
            px: 0.8, py: 0.2,
            border: `1.5px solid ${color}`, borderRadius: '4px',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color, fontWeight: 700, fontSize: '0.7rem' }}>
            {mapNum}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/* ─── Compound Card ──────────────────────────────────────────── */

function MappedCompoundCard({ token, smiles, name, atomColors }: {
  token: CompoundToken;
  smiles?: string;
  name?: string;
  atomColors?: AtomColors;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      {token.stoich && (
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          ({token.stoich})
        </Typography>
      )}
      <Box sx={{
        border: '1px solid #e0e0e0', borderRadius: 1, p: 1,
        background: '#fff', width: 150, height: 150,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <MoleculeRenderer smiles={smiles} compoundId={token.id} atomColors={atomColors} width={134} height={134} />
      </Box>
      <Typography variant="caption" sx={{ color: '#00acc1', fontWeight: 500 }}>{token.id}</Typography>
      {name && (
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem', textAlign: 'center', maxWidth: 150 }}>
          {name}
        </Typography>
      )}
    </Box>
  );
}

/* ─── Side ───────────────────────────────────────────────────── */

function MappedSide({ tokens, compoundMap, colorMap }: {
  tokens: CompoundToken[];
  compoundMap: Map<string, { name?: string; smiles?: string }>;
  colorMap: Map<string, AtomColors>;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      {tokens.map((token, idx) => {
        const data = compoundMap.get(token.id);
        return (
          <Box key={`${token.id}-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <MappedCompoundCard
              token={token}
              smiles={data?.smiles}
              name={data?.name}
              atomColors={colorMap.get(token.id)}
            />
            {idx < tokens.length - 1 && (
              <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 400 }}>+</Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/* ─── Main Component ─────────────────────────────────────────── */

export default function AtomMappedReaction({ reactionId, equation, reversibility }: AtomMappedReactionProps) {
  // 1) Fetch atom mapping bundle entry
  const { data: mappingEntry, isLoading: mappingLoading } = useQuery({
    queryKey: ['atom-mapping', reactionId],
    queryFn: () => getAtomMappingForReaction(reactionId),
    staleTime: Infinity,
  });

  // 2) Parse the equation into tokens
  const parsed = useMemo(() => (equation ? parseEquation(equation) : null), [equation]);

  // 3) Arrow symbol
  const arrow = useMemo(() => {
    let a = parsed?.arrow ?? '⇒';
    if (reversibility === '=' || reversibility === '<=>') a = '⇌';
    else if (reversibility === '>') a = '⇒';
    else if (reversibility === '<') a = '⇐';
    return a;
  }, [parsed?.arrow, reversibility]);

  // 4) Fetch compound SMILES + names
  const allIds = useMemo(
    () => parsed ? [...parsed.reactants.map((t) => t.id), ...parsed.products.map((t) => t.id)] : [],
    [parsed],
  );
  const uniqueIds = useMemo(() => Array.from(new Set(allIds)), [allIds]);
  const idsKey = useMemo(() => [...uniqueIds].sort().join(','), [uniqueIds]);

  const { data: compoundMap, isLoading: compoundsLoading } = useQuery({
    queryKey: ['reaction-structure-compounds', idsKey],
    queryFn: () => getCompoundsForReaction(uniqueIds),
    enabled: uniqueIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // 5) Build display map (id → { name, smiles })
  const displayMap = useMemo(() => {
    const map = new Map<string, { name?: string; smiles?: string }>();
    if (!compoundMap) return map;
    for (const [id, cpd] of compoundMap.entries()) map.set(id, { name: cpd.name, smiles: cpd.smiles });
    return map;
  }, [compoundMap]);

  // 6) Build per-compound atom-color maps from mapped SMILES
  const colorMap = useMemo(() => {
    const map = new Map<string, AtomColors>();
    if (!mappingEntry?.mapped_smiles || !parsed) return map;

    const { reactantFrags, productFrags } = splitReactionSmiles(mappingEntry.mapped_smiles);

    const apply = (frags: string[], tokens: CompoundToken[]) => {
      const fragColors = frags.map((f) => parseAtomMapColors(f));
      const tokenList = tokens.filter((t) => !map.has(t.id));
      for (let i = 0; i < tokenList.length && i < fragColors.length; i++) {
        const colors = fragColors[i].atomColors;
        if (Object.keys(colors).length > 0) map.set(tokenList[i].id, colors);
      }
    };

    apply(reactantFrags, parsed.reactants);
    apply(productFrags, parsed.products);
    return map;
  }, [mappingEntry, parsed]);

  /* ─── Render states ─── */

  if (mappingLoading || compoundsLoading) {
    return (
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', py: 1 }}>
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} variant="rectangular" width={150} height={150} sx={{ borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  if (!mappingEntry || !parsed) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
        Atom mapping not yet available for this reaction.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Badges */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label="rxnmapper"
          sx={{ fontFamily: 'monospace', fontWeight: 700, bgcolor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '0.65rem', height: 20 }}
        />
        <Chip
          size="small"
          label={`confidence: ${(mappingEntry.confidence * 100).toFixed(1)}%`}
          sx={{
            fontFamily: 'monospace', fontSize: '0.65rem', height: 20,
            bgcolor: mappingEntry.confidence >= 0.5 ? '#f0fdf4' : mappingEntry.confidence >= 0.2 ? '#fefce8' : '#fef2f2',
            color: mappingEntry.confidence >= 0.5 ? '#166534' : mappingEntry.confidence >= 0.2 ? '#854d0e' : '#991b1b',
            border: '1px solid',
            borderColor: mappingEntry.confidence >= 0.5 ? '#bbf7d0' : mappingEntry.confidence >= 0.2 ? '#fde68a' : '#fecaca',
          }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
          Atom-mapped — colors trace atoms across the reaction
        </Typography>
      </Box>

      {/* Equation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', py: 1 }}>
        <MappedSide tokens={parsed.reactants} compoundMap={displayMap} colorMap={colorMap} />
        <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 300, flexShrink: 0, px: 1, userSelect: 'none' }}>
          {arrow}
        </Typography>
        <MappedSide tokens={parsed.products} compoundMap={displayMap} colorMap={colorMap} />
      </Box>

      {/* Legend */}
      <AtomMapLegend mappedSmiles={mappingEntry.mapped_smiles} />
    </Box>
  );
}
