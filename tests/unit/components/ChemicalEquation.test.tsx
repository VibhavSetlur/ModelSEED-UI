import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataGrid, gridFilterModelSelector, type GridColDef, type GridFilterModel, useGridApiContext, useGridSelector } from '@mui/x-data-grid';
import ChemicalEquation from '@/components/ui/ChemicalEquation';
import type { Reaction } from '@/lib/api/biochem';

const participant = {
    compound: 'cpd05331',
    coefficient: -1,
    compartment: 0,
    name: 'Glucoraphanin',
    is_reactant: true,
};

function EquationCell({ equation, participants }: { equation: string; participants: Reaction['participants'] }) {
    const apiRef = useGridApiContext();
    const filterModel = useGridSelector(apiRef, gridFilterModelSelector);

    return <ChemicalEquation equation={equation} participants={participants} quickFilterValues={filterModel.quickFilterValues ?? []} />;
}

function renderEquation(quickFilterValues: string[], equation = 'cpd05331 + Glucoraphanin + H2O <=> Glucoraph', participants = [participant]) {
    const rows = [{ id: 'rxn00001', definition: equation, participants }] as Reaction[];
    const columns: GridColDef<Reaction>[] = [{
        field: 'definition',
        headerName: 'Equation',
        width: 600,
        renderCell: (params) => <EquationCell equation={params.value} participants={params.row.participants} />,
    }];
    const filterModel: GridFilterModel = { items: [], quickFilterValues };

    return render(
        <div style={{ height: 300, width: 700 }}>
            <DataGrid rows={rows} columns={columns} filterMode="server" initialState={{ filter: { filterModel } }} />
        </div>,
    );
}

describe('ChemicalEquation', () => {
    it('renders directly outside DataGrid context without highlights', () => {
        const { container } = render(<ChemicalEquation equation="(1) cpd05331[0] + H2O" />);

        expect(container.querySelectorAll('mark')).toHaveLength(0);
        expect(screen.getByRole('link', { name: 'cpd05331' }).getAttribute('href')).toBe('/biochem/compounds/cpd05331');
        expect(container.textContent).not.toContain('(1)');
        expect(container.textContent).not.toContain('[0]');
        expect(container.querySelector('sub')?.textContent).toBe('2');
    });

    it('highlights exact compound IDs, participant names, and substrings from multiple quick-filter terms', () => {
        renderEquation(['cpd05331 Glucoraphanin', 'Glucoraph']);

        const marks = screen.getAllByRole('mark');
        expect(marks.map((mark) => mark.textContent)).toEqual(expect.arrayContaining(['cpd05331', 'Glucoraphanin', 'Glucoraph']));
        expect(screen.getByRole('link', { name: 'cpd05331' }).getAttribute('href')).toBe('/biochem/compounds/cpd05331');
    });

    it('maps a nested participant compound-ID match to the visible participant name', () => {
        renderEquation(['cpd05331'], 'Glucoraphanin + H2O <=> Glucose');

        expect(screen.getByRole('mark').textContent).toContain('Glucoraphanin');
        expect(screen.queryByText('cpd05331')).toBeNull();
    });

    it('preserves legacy equations, links, cleanup, and subscripts without a query', () => {
        const { container } = renderEquation([], '(1) cpd05331[0] + H2O <=> cpd00001[1]');

        expect(container.querySelectorAll('mark')).toHaveLength(0);
        expect(screen.getByRole('link', { name: 'cpd05331' }).getAttribute('href')).toBe('/biochem/compounds/cpd05331');
        expect(container.textContent).not.toContain('(1)');
        expect(container.textContent).not.toMatch(/\[0\]|\[1\]/);
        expect(container.querySelector('sub')?.textContent).toBe('2');
    });

    it('does not mark absent or regex-like quick-filter terms', () => {
        const { container } = renderEquation(['missing', '[a-z]+(foo)?']);

        expect(container.querySelectorAll('mark')).toHaveLength(0);
        expect(container.textContent).toContain('Glucoraphanin');
    });
});
