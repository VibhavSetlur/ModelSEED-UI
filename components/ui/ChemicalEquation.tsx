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
    const result: React.ReactNode[] = [];

    parts.forEach((part, index) => {
        const offset = baseOffset + parts.slice(0, index).join('').length;
        const key = `${scope}-${offset}`;
        if (highlights.some((highlight) => part.toLowerCase() === highlight.toLowerCase())) {
            result.push(<mark key={key} style={markStyle}>{formatSubscripts(part, offset, key)}</mark>);
        } else {
            result.push(...formatSubscripts(part, offset, key));
        }
    });

    return result;
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

function getParticipantString(value: unknown): string | undefined {
    for (const candidate of Array.isArray(value) ? value : [value]) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
    }
    return undefined;
}

function getEquationHighlights(equation: string, participants: StoichiometryParticipant[] | unknown, quickFilterValues: string[] | unknown): string[] {
    const terms = (Array.isArray(quickFilterValues) ? quickFilterValues : [])
        .flatMap((value) => String(value ?? '').split(/\s+/))
        .map((term) => term.trim())
        .filter(Boolean);
    const safeParticipants = Array.isArray(participants) ? participants : [];
    const equationLower = equation.toLowerCase();
    const highlights = new Set<string>();

    for (const term of terms) {
        const termLower = term.toLowerCase();
        if (equationLower.includes(termLower)) highlights.add(term);
        for (const participant of safeParticipants) {
            if (!participant || typeof participant !== 'object') continue;
            const record = participant as Record<string, unknown>;
            const compound = getParticipantString(record.compound);
            const name = getParticipantString(record.name);
            if (!name || !(compound?.toLowerCase().includes(termLower) || name.toLowerCase().includes(termLower))) continue;
            if (equationLower.includes(name.toLowerCase())) highlights.add(name);
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
