// Zustand store -- single source of truth for accounts, navigation, and UI state.
import { create } from 'zustand';
import type { DriveAccount, PoolSummary, SearchResult, DriveFile, ImportResult } from './types';
import { driveApi } from './api';

interface DriveStore {
  accounts: DriveAccount[];
  poolSummary: PoolSummary;
  selectedAccountId: string | null;
  folderFiles: DriveFile[];
  folderBreadcrumbs: { id: string; name: string }[];
  searchResult: SearchResult | null;
  searchQuery: string;
  searchFilter: 'all' | 'file' | 'folder';
  isSearching: boolean;
  isLoading: boolean;
  activeTab: 'pool' | 'search' | 'files' | 'settings';
  language: 'tr' | 'en' | 'ru';
  theme: 'light' | 'dark';
  viewMode: 'list' | 'grid';
  error: string | null;

  setLanguage: (lang: 'tr' | 'en' | 'ru') => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setViewMode: (mode: 'list' | 'grid') => void;
  setActiveTab: (tab: 'pool' | 'search' | 'files' | 'settings') => void;
  loadAccounts: () => Promise<void>;
  loadPoolSummary: () => Promise<void>;
  selectAccount: (accountId: string | null) => void;
  toggleAccountEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteAccount: (id: string) => Promise<{ success: boolean; revoked: boolean; warning?: string }>;
  updateAccountLabel: (id: string, label: string) => Promise<void>;
  refreshAccountQuota: (id: string) => Promise<void>;
  refreshAllQuotas: () => Promise<void>;
  importAccounts: (items: any[]) => Promise<ImportResult>;
  exportAccounts: () => Promise<any[]>;
  exportAccountsEncrypted: (password: string) => Promise<string>;
  importAccountsEncrypted: (encryptedData: string, password: string) => Promise<ImportResult>;
  searchGlobal: (query: string, filter?: 'all' | 'file' | 'folder') => Promise<void>;
  loadFolderFiles: (accountId: string, folderId?: string, folderName?: string) => Promise<void>;
  navigateBreadcrumb: (index: number) => Promise<void>;
  startOAuthLogin: (clientId: string, clientSecret: string, scopes?: string[]) => Promise<{ success: boolean; email: string }>;
  mountStatus: { mounted: boolean; mountpoint: string };
  loadMountStatus: () => Promise<void>;
  mountPoolDrive: (mountpoint?: string) => Promise<{ success: boolean; mountpoint: string }>;
  unmountPoolDrive: () => Promise<boolean>;
  getSettings: () => Promise<Record<string, string>>;
  setSetting: (key: string, value: string) => Promise<void>;
}

export const useDriveStore = create<DriveStore>((set, get) => ({
  mountStatus: { mounted: false, mountpoint: '' },
  accounts: [],
  poolSummary: {
    total_accounts: 0,
    active_accounts: 0,
    invalid_accounts: 0,
    total_quota: 0,
    used_quota: 0,
    free_quota: 0,
    used_percentage: 0,
  },
  selectedAccountId: null,
  folderFiles: [],
  folderBreadcrumbs: [{ id: 'root', name: 'Root' }],
  searchResult: null,
  searchQuery: '',
  searchFilter: 'all',
  isSearching: false,
  isLoading: false,
  activeTab: 'pool',
  language: 'tr',
  theme: 'dark',
  viewMode: 'list',
  error: null,

  // Persist language preference to backend settings store.
  setLanguage: (language) => {
    set({ language });
    driveApi.setSetting('app_language', language);
  },

  // Sync theme class on <html> and persist.
  setTheme: (theme) => {
    set({ theme });
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    driveApi.setSetting('app_theme', theme);
  },
  toggleTheme: () => {
    const current = get().theme;
    const next = current === 'light' ? 'dark' : 'light';
    get().setTheme(next);
  },
  setViewMode: (viewMode) => set({ viewMode }),
  setActiveTab: (activeTab) => set({ activeTab }),

  loadAccounts: async () => {
    try {
      const accounts = await driveApi.getAccounts();
      set({ accounts });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadPoolSummary: async () => {
    try {
      const summary = await driveApi.getPoolSummary();
      set({ poolSummary: summary });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  // Reset breadcrumbs and fetch root listing on account switch.
  selectAccount: (selectedAccountId) => {
    set({ selectedAccountId, folderBreadcrumbs: [{ id: 'root', name: 'Root' }] });
    if (selectedAccountId) {
      get().loadFolderFiles(selectedAccountId, 'root');
    }
  },

  // Cascade: re-fetch both accounts and pool after toggle.
  toggleAccountEnabled: async (id: string, enabled: boolean) => {
    await driveApi.toggleAccount(id, enabled);
    await get().loadAccounts();
    await get().loadPoolSummary();
  },

  deleteAccount: async (id: string) => {
    const res = await driveApi.deleteAccount(id);
    // Clear selection if the deleted account was active.
    if (get().selectedAccountId === id) {
      set({ selectedAccountId: null, folderFiles: [] });
    }
    await get().loadAccounts();
    await get().loadPoolSummary();
    return res;
  },

  updateAccountLabel: async (id: string, label: string) => {
    await driveApi.updateAccountLabel(id, label);
    await get().loadAccounts();
  },

  refreshAccountQuota: async (id: string) => {
    try {
      set({ isLoading: true });
      await driveApi.refreshAccountQuota(id);
      await get().loadAccounts();
      await get().loadPoolSummary();
    } finally {
      set({ isLoading: false });
    }
  },

  refreshAllQuotas: async () => {
    try {
      set({ isLoading: true });
      await driveApi.refreshAllQuotas();
      await get().loadAccounts();
      await get().loadPoolSummary();
    } finally {
      set({ isLoading: false });
    }
  },

  importAccounts: async (items: any[]) => {
    set({ isLoading: true });
    try {
      const res = await driveApi.importAccounts(items);
      await get().loadAccounts();
      await get().loadPoolSummary();
      return res;
    } finally {
      set({ isLoading: false });
    }
  },

  exportAccounts: async () => {
    return await driveApi.exportAccounts();
  },

  exportAccountsEncrypted: async (password: string) => {
    return await driveApi.exportAccountsEncrypted(password);
  },

  importAccountsEncrypted: async (encryptedData: string, password: string) => {
    set({ isLoading: true });
    try {
      const res = await driveApi.importAccountsEncrypted(encryptedData, password);
      await get().loadAccounts();
      await get().loadPoolSummary();
      return res;
    } finally {
      set({ isLoading: false });
    }
  },

  // Parallel search across all enabled accounts.
  searchGlobal: async (query: string = '', filter: 'all' | 'file' | 'folder' = 'all') => {
    set({ isSearching: true, searchQuery: query, searchFilter: filter, activeTab: 'search' });
    try {
      const res = await driveApi.searchAllAccounts(query, filter);
      set({ searchResult: res });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ isSearching: false });
    }
  },

  // Navigate into a folder. Breadcrumbs are appended only if folderId is new.
  loadFolderFiles: async (accountId: string, folderId = 'root', folderName?: string) => {
    set({ isLoading: true });
    try {
      const files = await driveApi.listAccountFiles(accountId, folderId);
      const breadcrumbs = [...get().folderBreadcrumbs];
      if (folderId === 'root') {
        set({ folderBreadcrumbs: [{ id: 'root', name: 'Root' }] });
      } else if (folderName && !breadcrumbs.find((b) => b.id === folderId)) {
        breadcrumbs.push({ id: folderId, name: folderName });
        set({ folderBreadcrumbs: breadcrumbs });
      }
      set({ folderFiles: files });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ isLoading: false });
    }
  },

  // Truncate breadcrumbs to the clicked index and reload that folder.
  navigateBreadcrumb: async (index: number) => {
    const { folderBreadcrumbs, selectedAccountId } = get();
    if (!selectedAccountId || index >= folderBreadcrumbs.length) return;
    const target = folderBreadcrumbs[index];
    const newBreadcrumbs = folderBreadcrumbs.slice(0, index + 1);
    set({ folderBreadcrumbs: newBreadcrumbs });
    await get().loadFolderFiles(selectedAccountId, target.id);
  },

  // Full OAuth flow: PKCE + state, ephemeral 127.0.0.1, scope selectable
  startOAuthLogin: async (clientId: string, clientSecret: string, scopes?: string[]) => {
    set({ isLoading: true });
    try {
      const res = await driveApi.startGoogleOAuth(clientId, clientSecret, scopes);
      await get().loadAccounts();
      await get().loadPoolSummary();
      return res;
    } finally {
      set({ isLoading: false });
    }
  },

  getSettings: async () => {
    return await driveApi.getSettings();
  },

  loadMountStatus: async () => {
    try {
      const status = await driveApi.getMountStatus();
      set({ mountStatus: status });
    } catch (e: any) {
      console.error("Failed to fetch mount status:", e);
    }
  },

  mountPoolDrive: async (mountpoint?: string) => {
    set({ isLoading: true });
    try {
      const res = await driveApi.mountPoolDrive(mountpoint);
      set({ mountStatus: { mounted: res.success, mountpoint: res.mountpoint } });
      return res;
    } finally {
      set({ isLoading: false });
    }
  },

  unmountPoolDrive: async () => {
    set({ isLoading: true });
    try {
      const ok = await driveApi.unmountPoolDrive();
      if (ok) {
        set({ mountStatus: { mounted: false, mountpoint: '' } });
      }
      return ok;
    } finally {
      set({ isLoading: false });
    }
  },

  setSetting: async (key: string, value: string) => {
    await driveApi.setSetting(key, value);
  },
}));
