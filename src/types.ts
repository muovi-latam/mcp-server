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
  /** WEB-1039: the identifier the other tools take. */
  id: string;
  display_name: string;
  headline?: string | null;
  avatar_url?: string | null;
  /** In a search result (WEB-1055): the searched barrio's city. */
  city: CityRef;
  services: ServiceRef[];
  rating: number;
  review_count: number;
  // MOB-262: years_active removed from the public contract.
  verifications: PublicVerifications;
  /** Portfolio image URLs: up to 3 in a search result (WEB-1055). */
  portfolio: string[];
  /** WEB-1039: the public profile page `<origin>/profile/<id>`. */
  profile_url: string;
}

export interface ProfessionalDetail extends Professional {
  /** The professional's own base label. Not part of a search result (WEB-1055). */
  neighborhoods: NeighborhoodRef[];
  bio: string | null;
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

/** WEB-1055: what a search matched on. `basis` is the rule every result met. */
export interface SearchMatch {
  basis: 'coverage_area_includes_neighborhood';
  service: { slug: string; name: string };
  neighborhood: NeighborhoodRef;
  city: { slug: string; name: string };
}

export interface SearchResponse extends ListResponse<Professional> {
  match: SearchMatch;
}

export interface DetailResponse<T> {
  data: T;
}

export interface CatalogResponse<T> {
  data: T[];
}
