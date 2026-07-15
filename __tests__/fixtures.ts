/**
 * Test fixtures for the MCP server tool tests.
 *
 * `cleanProfessionalSearchPayload` and friends mirror canonical responses
 * from the /v1 API exactly (cross-checked against `public/openapi.yaml`
 * examples). `leakyPro` mirrors the canonical leaky fixture from
 * `src/lib/anti-leakage/fixtures/leakyPro.ts` to exercise the runtime
 * anti-leakage assertion at the MCP boundary.
 */

export const cleanProfessional = {
  id: '8e3c5b41-6f2a-4f7e-8b1d-2c0a9d8f6c11',
  slug: 'juan-p-electricista-caba',
  display_name: 'Juan P.',
  headline: 'Electricista matriculado · CABA',
  avatar_url: null,
  city: { slug: 'caba', name: 'CABA' },
  neighborhoods: [
    { slug: 'palermo', name: 'Palermo' },
    { slug: 'villa-crespo', name: 'Villa Crespo' },
  ],
  services: [{ slug: 'electricidad', name: 'Electricidad' }],
  rating: 4.8,
  review_count: 142,
  // MOB-262: years_active removed from the public contract.
  verifications: {
    identity_verified: true,
    phone_verified: true,
    email_verified: true,
    matricula: { verified: true, type: 'electricista_categoria_1' },
    background_check: true,
    // MOB-262: years_active removed from PublicVerifications.
  },
  profile_url: 'https://muovi.com.ar/p/juan-p-electricista-caba',
} as const;

export const cleanProfessionalDetail = {
  ...cleanProfessional,
  bio: 'Electricista matriculado con 12 años de experiencia en instalaciones residenciales y comerciales.',
  portfolio: [
    'https://cdn.muovi.com.ar/portfolio/juan-p-1.jpg',
    'https://cdn.muovi.com.ar/portfolio/juan-p-2.jpg',
  ],
  specialties: ['Tableros', 'Iluminación LED'],
  member_since: '2024-03-11T10:00:00Z',
} as const;

export const cleanSearchResponse = {
  data: [cleanProfessional],
  pagination: { limit: 20, offset: 0, total: 1, has_more: false },
} as const;

export const cleanServicesResponse = {
  data: [
    {
      slug: 'electricidad',
      name: 'Electricidad',
      description: 'Instalaciones, reparaciones y mantenimiento eléctrico.',
      requires_matricula: true,
    },
    {
      slug: 'plomeria',
      name: 'Plomería',
      description: 'Reparación de cañerías, instalaciones sanitarias.',
      requires_matricula: false,
    },
  ],
} as const;

export const cleanCitiesResponse = {
  data: [
    {
      slug: 'caba',
      name: 'CABA',
      region: 'Buenos Aires',
      neighborhoods: [
        { slug: 'palermo', name: 'Palermo' },
        { slug: 'villa-crespo', name: 'Villa Crespo' },
      ],
    },
  ],
} as const;

export const cleanReviewsResponse = {
  data: [
    {
      id: 'r-9981',
      rating: 5,
      title: 'Excelente trabajo',
      comment: 'Vino puntual, trabajó muy prolijo y dejó todo limpio.',
      author_name: 'María G.',
      author_role: 'client',
      author_avatar_url: null,
      service_name: 'Electricidad',
      created_at: '2026-05-12T18:33:00Z',
    },
  ],
  pagination: { limit: 20, offset: 0, total: 1, has_more: false },
} as const;

/**
 * Mirrors src/lib/anti-leakage/fixtures/leakyPro.ts — covers all four
 * leak categories (forbidden_key, phone_pattern, email_pattern,
 * whatsapp_pattern). The `bio` value carries an email so the detector
 * fires the `email_pattern` branch via a value scan (not just the key).
 */
export const leakyProResponse = {
  data: {
    id: 'pro_01HXYZ',
    slug: 'juan-electricista',
    display_name: 'Juan Electricista',
    rating: 4.8,
    profile_url: 'https://muovi.com.ar/p/juan-electricista',
    // Forbidden-key categories (the walker stops at the key match).
    phone: '+54 9 11 1234-5678',
    email: 'juan@example.com',
    // Value-only categories must live under innocuous keys — the walker
    // only classifies values when the key itself is benign.
    bio: 'Reach me anytime at +54 9 11 9876-5432.',
    notes: 'Or find me via https://wa.me/541199998888 for WhatsApp.',
    backup_contact: 'maria@example.com is my backup.',
  },
} as const;

export interface MockFetchEntry {
  url: string | RegExp;
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Build a fake `fetch` that matches requests by URL.
 * Returns each entry only once unless `repeat` is set.
 */
export function makeMockFetch(entries: MockFetchEntry[]): {
  fetch: typeof fetch;
  calls: { url: string; method: string }[];
} {
  const queue = [...entries];
  const calls: { url: string; method: string }[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });

    const idx = queue.findIndex((e) =>
      typeof e.url === 'string' ? url === e.url || url.startsWith(e.url) : e.url.test(url),
    );
    if (idx === -1) {
      throw new Error(`Unexpected fetch call: ${url}`);
    }
    const entry = queue.splice(idx, 1)[0]!;
    const status = entry.status ?? 200;
    const body = JSON.stringify(entry.body);
    return new Response(body, {
      status,
      headers: {
        'content-type': 'application/json',
        ...(entry.headers ?? {}),
      },
    });
  };

  return { fetch: mockFetch, calls };
}
