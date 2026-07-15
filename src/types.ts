/**
 * Mirrored shape of the Muovi public `/v1` API.
 *
 * Kept minimal and *structurally* aligned with `public/openapi.yaml` —
 * if you tighten the public contract, mirror it here.
 */

export interface PublicVerifications {
  identity_verified: boolean;
  phone_verified: boolean;
  email_verified: boolean;
  matricula: {
    verified: boolean;
    type: string | null;
  };
  background_check: boolean;
  // MOB-262: years_active removed from the public contract.
}

export interface ServiceRef {
  slug: string;
  name: string;
  description?: string | null;
  requires_matricula?: boolean;
}

export interface NeighborhoodRef {
  slug: string;
  name: string;
}

export interface CityRef {
  slug: string;
  name: string;
  region?: string | null;
  neighborhoods?: NeighborhoodRef[];
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface Professional {
  id: string;
  // WEB-393: the list emits the real published tenant_settings.slug, or `null`
  // when the pro has no published pro-site (no live detail page). Never a UUID.
  slug: string | null;
  display_name: string;
  headline?: string | null;
  avatar_url?: string | null;
  city: CityRef;
  neighborhoods: NeighborhoodRef[];
  services: ServiceRef[];
  rating: number;
  review_count: number;
  // MOB-262: years_active removed from the public contract.
  verifications: PublicVerifications;
  // WEB-393: omitted entirely when there is no published slug.
  profile_url?: string;
}

export interface ProfessionalDetail extends Professional {
  // The detail endpoint only resolves published pros, so it always has a slug.
  slug: string;
  profile_url: string;
  bio: string | null;
  portfolio: string[];
  specialties: string[];
  member_since: string;
}

export interface Review {
  id: string;
  rating: number;
  title?: string | null;
  comment?: string | null;
  author_name: string;
  author_role: 'client' | 'worker';
  author_avatar_url?: string | null;
  service_name?: string | null;
  created_at: string;
}

export interface ListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface DetailResponse<T> {
  data: T;
}

export interface CatalogResponse<T> {
  data: T[];
}
