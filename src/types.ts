// Shared type definitions for the River frontend.

export type Language = 'tr' | 'en' | 'ru';
export type ViewMode = 'list' | 'grid';

export interface TranslationDictionary {
  [key: string]: {
    tr: string;
    en: string;
    ru: string;
  };
}

/** Represents a single Google Drive service account or OAuth credential. */
export interface DriveAccount {
  id: string;
  email: string;
  label?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  quota_used: number;
  quota_total: number;
  quota_updated_at?: number;
  status: 'active' | 'invalid' | 'rate_limited' | 'revoked';
  last_error?: string;
  avatar_url?: string;
  is_enabled: boolean;
  created_at: number;
  last_used?: number;
}

/** Aggregated quota across all accounts in the pool. */
export interface PoolSummary {
  total_accounts: number;
  active_accounts: number;
  invalid_accounts: number;
  total_quota: number;
  used_quota: number;
  free_quota: number;
  used_percentage: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  size?: number;
  modified_time?: string;
  web_view_link?: string;
  web_content_link?: string;
  icon_link?: string;
  thumbnail_link?: string;
  account_email?: string;
  account_label?: string;
  account_id?: string;
}

/** Per-account hit count returned alongside search results. */
export interface AccountSearchResult {
  email: string;
  label?: string;
  count: number;
  error?: string | null;
}

export interface SearchResult {
  total_found: number;
  files: DriveFile[];
  account_results: AccountSearchResult[];
}

export interface ImportResult {
  imported: number;
  updated: number;
  failed: number;
  errors: string[];
}

export interface MountStatus {
  mounted: boolean;
  mountpoint: string;
}
