import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSolrSchemaCache } from '@/lib/api/solrSchema';

async function loadBiochemApi() {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_MODE', 'staging');
    return import('@/lib/api/biochem');
}

function mockNestedFetch() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        const isProbe = String(input).includes('rows=0');
        const body = { response: { numFound: isProbe ? 1 : 0, start: 0, docs: [] } };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
}

describe('Solr nested reaction quick search', () => {
    beforeEach(() => resetSolrSchemaCache());
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        resetSolrSchemaCache();
    });

    it('searches Equation compound names on parent reactions without stoichiometry', async () => {
        const api = await loadBiochemApi();
        const fetchMock = mockNestedFetch();

        await api.getReactions({ filterModel: { items: [], quickFilterValues: ['Gluconapin'] } });

        const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? '');
        const query = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
        expect(query).toContain('definition:*Gluconapin*');
        expect(query).not.toContain('stoichiometry:');
        expect(url).toContain(`fq=${encodeURIComponent('doc_type:reaction')}`);
    });
});
