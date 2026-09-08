'use client';

import React from 'react';
import Link from 'next/link';
import type { StoichiometryParticipant } from '@/lib/api/biochem';

const markStyle = { backgroundColor: '#fff3cd', color: '#856404', padding: '0 2px', borderRadius: '2px' };

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatSubscripts(text: string, baseOffset = 0, scope = 'txt'): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const segmentRegex = /([A-Za-z]+)|(\d+(?:\.\d+)?)|([^A-Za-z\d]+)/g;
    let match;
    let lastTokenWasLetter = false;

    while ((match = segmentRegex.exec(text)) !== null) {
        const [, letters, digits, other] = match;
        const keyBase = `${scope}-${baseOffset + match.index}-${segmentRegex.lastIndex}`;

        if (letters) {
            parts.push(<span key={`${keyBase}-letters`}>{letters}</span>);
            lastTokenWasLetter = true;
        } else if (digits) {
            if (lastTokenWasLetter) {
                parts.push(<sub key={`${keyBase}-sub`}>{digits}</sub>);
            } else {
                parts.push(<span key={`${keyBase}-digits`}>{digits}</span>);
            }
            lastTokenWasLetter = false;
        } else {
            parts.push(<span key={`${keyBase}-other`}>{other}</span>);
            if (other.trim().length > 0 || /\s/.test(other)) {
                lastTokenWasLetter = false;
            }
        }
    }

    return parts;
}

function formatHighlightedText(text: string, highlights: string[], baseOffset: number, scope: string): React.ReactNode[] {
    if (highlights.length === 0) return formatSubscripts(text, baseOffset, scope);

    const pattern = highlights.map(escapeRegExp).join('|');
    const parts = text.split(new RegExp(`(${pattern})`, 'gi'));
    return parts.flatMap((part, index) => {
        const offset = baseOffset + parts.slice(0, index).join('').length;
        const key = `${scope}-${offset}`;
        return highlights.some((highlight) => part.toLowerCase() === highlight.toLowerCase())
            ? [<mark key={key} style={markStyle}>{formatSubscripts(part, offset, key)}</mark>]
            : formatSubscripts(part, offset, key);
    });
}

function formatChemicalText(text: string, highlights: string[]): React.ReactNode[] {
    const result: React.ReactNode[] = [];
    const compoundRegex = /(cpd\d{5})/g;
    let lastIndex = 0;
    let match;

    while ((match = compoundRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const before = text.slice(lastIndex, match.index);
            result.push(...formatHighlightedText(before, highlights, lastIndex, 'before'));
        }

        const compound = match[1];
        const isHighlighted = highlights.some((highlight) => compound.toLowerCase() === highlight.toLowerCase());
        result.push(
            <Link
                key={`cpd-${match.index}-${compound}`}
                href={`/biochem/compounds/${compound}`}
                style={{ color: '#00acc1', textDecoration: 'none' }}
            >
                {isHighlighted ? <mark style={markStyle}>{compound}</mark> : compound}
            </Link>
        );

        lastIndex = match.index + compound.length;
    }

    if (lastIndex < text.length) {
        const after = text.slice(lastIndex);
        result.push(...formatHighlightedText(after, highlights, lastIndex, 'after'));
    }

    return result;
}

function getEquationHighlights(equation: string, participants: StoichiometryParticipant[], quickFilterValues: string[]): string[] {
    const terms = quickFilterValues
        .flatMap((value) => String(value ?? '').split(/\s+/))
        .map((term) => term.trim())
        .filter(Boolean);
    const highlights = new Set<string>();

    for (const term of terms) {
        if (equation.toLowerCase().includes(term.toLowerCase())) highlights.add(term);
        for (const participant of participants) {
            if (participant.compound.toLowerCase().includes(term.toLowerCase()) || participant.name.toLowerCase().includes(term.toLowerCase())) {
                if (equation.toLowerCase().includes(participant.name.toLowerCase())) highlights.add(participant.name);
            }
        }
    }

    return [...highlights].sort((a, b) => b.length - a.length);
}

interface ChemicalEquationProps {
    equation: string | undefined | null;
    participants?: StoichiometryParticipant[];
    quickFilterValues?: string[];
}

export default function ChemicalEquation({ equation, participants = [], quickFilterValues = [] }: ChemicalEquationProps) {
    if (!equation) return 'N/A';

    const cleaned = equation
        .replace(/\[\d+\]/g, '')
        .replace(/\(1\)\s*/g, '');
    const highlights = getEquationHighlights(cleaned, participants, quickFilterValues);

    return (
        <span style={{ fontFamily: 'monospace' }}>
            {formatChemicalText(cleaned, highlights)}
        </span>
    );
}
