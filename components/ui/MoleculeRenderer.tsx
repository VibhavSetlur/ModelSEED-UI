'use client';

import { useEffect, useMemo, useState } from 'react';
import Skeleton from '@mui/material/Skeleton';
import { getRDKit } from '@/lib/rdkit';
import { getCompoundImageUrl } from '@/lib/api/biochem';

/**
 * Maps atom index (0-based) to a CSS color string.
 * Used for atom-mapping overlays once mapping data is available.
 */
export type AtomColors = Record<number, string>;

interface MoleculeRendererProps {
    /** SMILES string to render dynamically via RDKit.js */
    smiles?: string;
    /** Compound ID used for the PNG fallback (CPD_IMG_BASE/{id}.png) */
    compoundId: string;
    /** Optional per-atom color map for atom-mapping overlays */
    atomColors?: AtomColors;
    width?: number;
    height?: number;
    alt?: string;
}

type RenderState = 'loading' | 'svg' | 'png' | 'hidden';

/** CSS #hex -> RDKit draw colour [r,g,b] in 0..1 */
function hexToRgb01(hex: string): [number, number, number] {
    const h = hex.replace('#', '').trim();
    const full =
        h.length === 3
            ? h
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : h;
    if (full.length !== 6) return [0.2, 0.4, 0.9];
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    return [r, g, b];
}

/**
 * Bonds whose both endpoints are highlighted — bond index matches RDKit JSON `molecules[0].bonds` order.
 */
function bondsBetweenHighlightedAtoms(
    mol: { get_json: () => string },
    atomIndices: number[],
    highlightAtomColors: Record<number, [number, number, number]>,
): { bonds: number[]; highlightBondColors: Record<number, [number, number, number]> } {
    const set = new Set(atomIndices);
    try {
        const data = JSON.parse(mol.get_json()) as {
            molecules?: Array<{ bonds?: Array<{ atoms: [number, number] }> }>;
        };
        const bonds = data.molecules?.[0]?.bonds ?? [];
        const outBonds: number[] = [];
        const highlightBondColors: Record<number, [number, number, number]> = {};

        bonds.forEach((b, bondIdx) => {
            const [a1, a2] = b.atoms;
            if (!set.has(a1) || !set.has(a2)) return;
            outBonds.push(bondIdx);
            const rgb = highlightAtomColors[a1] ?? highlightAtomColors[a2];
            if (rgb) highlightBondColors[bondIdx] = rgb;
        });

        return { bonds: outBonds, highlightBondColors };
    } catch {
        return { bonds: [], highlightBondColors: {} };
    }
}

export default function MoleculeRenderer({
    smiles,
    compoundId,
    atomColors,
    width = 150,
    height = 150,
    alt,
}: MoleculeRendererProps) {
    const [state, setState] = useState<RenderState>('loading');
    const [svgString, setSvgString] = useState<string>('');
    const atomColorsKey = useMemo(() => JSON.stringify(atomColors ?? {}), [atomColors]);

    useEffect(() => {
        let cancelled = false;

        if (!smiles) {
            setState('png');
            return;
        }

        getRDKit()
            .then((RDKit) => {
                if (cancelled) return;

                try {
                    const mol = RDKit.get_mol(smiles);
                    try {
                        let svg: string;

                        if (atomColors && Object.keys(atomColors).length > 0) {
                            const atomIndices = Object.keys(atomColors).map(Number);
                            const highlightAtomColors: Record<number, [number, number, number]> = {};
                            for (const idx of atomIndices) {
                                highlightAtomColors[idx] = hexToRgb01(atomColors[idx]);
                            }

                            const { bonds, highlightBondColors } = bondsBetweenHighlightedAtoms(
                                mol,
                                atomIndices,
                                highlightAtomColors,
                            );

                            // MetaCyc-like: emphasize coloured atom symbols, not large filled halos.
                            // See RDKit MolDrawOptions (fillHighlights, circleAtoms, continuousHighlight).
                            svg = mol.get_svg_with_highlights(
                                JSON.stringify({
                                    atoms: atomIndices,
                                    bonds,
                                    highlightAtomColors,
                                    highlightBondColors,
                                    width,
                                    height,
                                    continuousHighlight: false,
                                    circleAtoms: false,
                                    fillHighlights: false,
                                    atomHighlightsAreCircles: false,
                                    standardColoursForHighlightedAtoms: false,
                                    scaleHighlightBondWidth: false,
                                    highlightBondWidthMultiplier: 4,
                                    // 1 = LASSO (alternative to default CIRCLEANDLINE for multi-colour)
                                    multiColourHighlightStyle: 1,
                                }),
                            );
                        } else {
                            svg = mol.get_svg(width, height);
                        }

                        if (!cancelled) {
                            setSvgString(svg);
                            setState('svg');
                        }
                    } finally {
                        // Always free WASM heap memory immediately after extracting the SVG string
                        mol.delete();
                    }
                } catch {
                    // Invalid SMILES or RDKit error — fall back to CDN PNG silently
                    if (!cancelled) setState('png');
                }
            })
            .catch(() => {
                if (!cancelled) setState('png');
            });

        return () => {
            cancelled = true;
        };
    }, [smiles, atomColorsKey, width, height]);

    if (state === 'loading') {
        return (
            <Skeleton
                variant="rectangular"
                width={width}
                height={height}
                sx={{ borderRadius: 1 }}
            />
        );
    }

    if (state === 'svg') {
        const svgLabel = alt ?? `Structure of ${compoundId}`;
        return (
            <div
                role="img"
                aria-label={svgLabel}
                dangerouslySetInnerHTML={{ __html: svgString }}
                style={{
                    width,
                    height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                }}
            />
        );
    }

    if (state === 'png') {
        return (
            <img
                src={getCompoundImageUrl(compoundId)}
                alt={alt ?? `Structure of ${compoundId}`}
                style={{
                    width,
                    height,
                    objectFit: 'contain',
                    border: '1px solid #e0e0e0',
                    borderRadius: 4,
                    padding: 4,
                    background: '#fff',
                }}
                onError={() => setState('hidden')}
            />
        );
    }

    // state === 'hidden': no structure available at all
    return null;
}
