// Tauri IPC bridge -- wraps `invoke` calls and normalizes backend responses.
import { invoke } from "@tauri-apps/api/core";
import type { DriveAccount, PoolSummary, SearchResult, DriveFile, ImportResult } from "./types";

/** Backend field names may vary (snake_case vs camelCase). Normalize to PoolSummary shape. */
function normalizePoolSummary(raw: any): PoolSummary {
  if (!raw) {
    return { total_accounts: 0, active_accounts: 0, invalid_accounts: 0, total_quota: 0, used_quota: 0, free_quota: 0, used_percentage: 0 };
  }
  return {
    total_accounts: raw.total_accounts ?? raw.totalAccounts ?? 0,
    active_accounts: raw.active_accounts ?? raw.activeAccounts ?? 0,
    invalid_accounts: raw.invalid_accounts ?? raw.invalidAccounts ?? 0,
    total_quota: raw.total_quota ?? raw.total_quota_bytes ?? raw.totalQuota ?? 0,
    used_quota: raw.used_quota ?? raw.used_quota_bytes ?? raw.usedQuota ?? 0,
    free_quota: raw.free_quota ?? raw.free_quota_bytes ?? raw.freeQuota ?? 0,
    used_percentage: raw.used_percentage ?? raw.usedPercentage ?? 0,
  };
}

/**
 * Normalize search payload. Builds per-account result stats from the flat
 * file list when the backend doesn't provide them (backward compat).
 */
function normalizeSearchResult(raw: any, query: string): SearchResult {
  if (!raw) return { total_found: 0, files: [], account_results: [] };
  const files: DriveFile[] = (raw.files ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mime_type: f.mime_type ?? f.mimeType ?? "",
    size: f.size ?? undefined,
    modified_time: f.modified_time ?? f.modifiedTime ?? undefined,
    web_view_link: f.web_view_link ?? f.webViewLink ?? undefined,
    web_content_link: f.web_content_link ?? f.webContentLink ?? undefined,
    icon_link: f.icon_link ?? f.iconLink ?? undefined,
    thumbnail_link: f.thumbnail_link ?? f.thumbnailLink ?? undefined,
    account_email: f.account_email ?? f.accountEmail ?? "",
    account_label: f.account_label ?? f.accountLabel ?? undefined,
    account_id: f.account_id ?? f.accountId ?? undefined,
  }));
  // Synthesize per-account counts if backend omits them.
  let account_results = raw.account_results ?? raw.accountResults ?? null;
  if (!account_results && Array.isArray(files)) {
    const map = new Map<string, number>();
    for (const f of files) {
      const key = f.account_email || "unknown";
      map.set(key, (map.get(key) || 0) + 1);
    }
    account_results = Array.from(map.entries()).map(([email, count]) => ({ email, count, error: null }));
  }
  // Merge error entries from backend into account results.
  if (raw.errors && raw.errors.length > 0) {
    const errResults = raw.errors.map((e: string) => ({ email: e.split(":")[0] || "error", count: 0, error: e }));
    account_results = [...(account_results || []), ...errResults];
  }
  return {
    total_found: raw.total_found ?? files.length,
    files,
    account_results: account_results || [],
  };
}

export const driveApi = {
  getAccounts: async (): Promise<DriveAccount[]> => {
    try {
      const res = await invoke<DriveAccount[]>("get_accounts");
      return res || [];
    } catch (e) { console.error(e); return []; }
  },

  getPoolSummary: async (): Promise<PoolSummary> => {
    try {
      const raw = await invoke<any>("get_pool_summary");
      return normalizePoolSummary(raw);
    } catch (e) { console.error(e); return normalizePoolSummary(null); }
  },

  importAccounts: async (items: any[]): Promise<ImportResult> => {
    try {
      const res: any = await invoke("import_accounts", { accounts: items });
      return { imported: res.imported ?? 0, updated: res.updated ?? 0, failed: res.failed ?? 0, errors: res.errors ?? [] };
    } catch (e: any) { return { imported: 0, updated: 0, failed: items.length, errors: [String(e)] }; }
  },

  exportAccounts: async (): Promise<any[]> => {
    try {
      const res = await invoke<any[]>("export_accounts", { account_ids: null });
      return res || [];
    } catch (e) { console.error(e); return []; }
  },

  deleteAccount: async (id: string): Promise<{ success: boolean; revoked: boolean; warning?: string }> => {
    try {
      const res: any = await invoke("delete_account", { id });
      return { success: true, revoked: res.revoked ?? false, warning: res.warning || undefined };
    } catch (e: any) {
      return { success: false, revoked: false, warning: String(e) };
    }
  },

  toggleAccount: async (id: string, enabled: boolean): Promise<boolean> => {
    try { await invoke("toggle_account", { id, enabled }); return true; } catch { return false; }
  },

  updateAccountLabel: async (id: string, label: string): Promise<boolean> => {
    try { await invoke("update_account_label", { id, label: label || null }); return true; } catch { return false; }
  },

  refreshAccountQuota: async (id: string): Promise<void> => {
    await invoke("refresh_account_quota", { id });
  },

  refreshAllQuotas: async (): Promise<void> => {
    await invoke("refresh_all_quotas");
  },

  /** Cross-account search. `mimeFilter` is ignored when set to "all". */
  searchAllAccounts: async (query: string, mimeFilter?: string): Promise<SearchResult> => {
    const raw: any = await invoke("search_all_accounts", {
      query: query || null,
      filter: mimeFilter && mimeFilter !== "all" ? mimeFilter : null,
    });
    return normalizeSearchResult(raw, query);
  },

  /** List children of a folder. `null` parent_id = Drive root. */
  listAccountFiles: async (accountId: string, folderId?: string): Promise<DriveFile[]> => {
    try {
      const parent_id = !folderId || folderId === "root" ? null : folderId;
      const res = await invoke<any[]>("list_account_files", {
        account_id: accountId,
        parent_id: parent_id,
      });
      return (res || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        mime_type: f.mime_type ?? f.mimeType ?? "",
        size: f.size ?? undefined,
        modified_time: f.modified_time ?? f.modifiedTime ?? undefined,
        web_view_link: f.web_view_link ?? f.webViewLink ?? undefined,
        web_content_link: f.web_content_link ?? undefined,
        icon_link: f.icon_link ?? f.iconLink ?? undefined,
    thumbnail_link: f.thumbnail_link ?? f.thumbnailLink ?? undefined,
        account_email: f.account_email ?? f.accountEmail ?? undefined,
        account_id: f.account_id ?? f.accountId ?? undefined,
      }));
    } catch (e) {
      console.error("listAccountFiles error:", e);
      return [];
    }
  },

  /** Open URL via Tauri shell; falls back to window.open if invoke fails. */
  openExternalUrl: async (url: string): Promise<void> => {
    try { await invoke("open_url", { url }); } catch (e) { console.error(e); window.open(url, "_blank"); }
  },

  /** Kick off the OAuth consent flow. Now uses PKCE + 127.0.0.1 ephemeral, port ignored. */
  startGoogleOAuth: async (clientId: string, clientSecret: string, scopes?: string[]): Promise<{ success: boolean; email: string }> => {
    const res: any = await invoke("start_google_oauth", { client_id: clientId || null, client_secret: clientSecret || null, scopes: scopes || null });
    return { success: true, email: res.email || "" };
  },
  getStreamCreds: async (): Promise<{ port: number; token: string }> => {
    try {
      const res: any = await invoke("get_stream_creds");
      return { port: res.port, token: res.token };
    } catch {
      const port = await invoke<number>("get_stream_port").catch(() => 0);
      const token = await invoke<string>("get_stream_token").catch(() => "");
      return { port, token };
    }
  },
  exportAccountsEncrypted: async (password: string, accountIds?: string[]): Promise<string> => {
    return await invoke<string>("export_accounts_encrypted", { account_ids: accountIds || null, password });
  },
  importAccountsEncrypted: async (encryptedData: string, password: string): Promise<ImportResult> => {
    const res: any = await invoke("import_accounts_encrypted", { encrypted_data: encryptedData, password });
    return { imported: res.imported ?? 0, updated: res.updated ?? 0, failed: res.failed ?? 0, errors: res.errors ?? [] };
  },

  getSettings: async (): Promise<Record<string, string>> => {
    try { return await invoke<Record<string, string>>("get_settings"); } catch { return {}; }
  },

  setSetting: async (key: string, value: string): Promise<boolean> => {
    try { await invoke("set_setting", { key, value }); return true; } catch { return false; }
  },

  /** Raw byte download -- returns number[] from Tauri. */
  downloadFileRaw: async (accountId: string, fileId: string, mimeType?: string): Promise<number[]> => {
    const data: number[] = await invoke("download_file", { account_id: accountId, file_id: fileId, mime_type: mimeType || null });
    return data;
  },

  /**
   * Try native save first (save_file_to_downloads). On failure, fall back
   * to in-memory blob + anchor click so the user still gets the file.
   */
  downloadFile: async (accountId: string, fileId: string, fileName: string, mimeType?: string): Promise<{ success: boolean; filePath?: string; canceled?: boolean }> => {
    try {
      const filePath: string = await invoke("save_file_to_downloads", { account_id: accountId, file_id: fileId, file_name: fileName, mime_type: mimeType || null });
      return { success: true, filePath };
    } catch (e: any) {
      console.error("save_file_to_downloads failed, falling back to blob:", e);
      try {
        const data: number[] = await invoke("download_file", { account_id: accountId, file_id: fileId, mime_type: mimeType || null });
        const uint8 = new Uint8Array(data);
        const blob = new Blob([uint8]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return { success: true };
      } catch (e2: any) {
        console.error(e2);
        return { success: false };
      }
    }
  },

  /** Download to blob and open in a new browser tab for quick preview. */
  openFileLocal: async (accountId: string, fileId: string, fileName: string, mimeType?: string): Promise<{ success: boolean; path?: string }> => {
    try {
      const data: number[] = await invoke("download_file", { account_id: accountId, file_id: fileId, mime_type: mimeType || null });
      const uint8 = new Uint8Array(data);
      const blob = new Blob([uint8]);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      // Revoke after a short delay so the tab has time to load.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { success: true };
    } catch (e) { console.error(e); return { success: false }; }
  },

  uploadFileBuffer: async (accountId: string, parentFolderId: string, fileName: string, base64Data: string, mimeType?: string): Promise<any> => {
    return await invoke("upload_file_buffer", { account_id: accountId, parent_folder_id: parentFolderId, file_name: fileName, base64_data: base64Data, mime_type: mimeType || null });
  },

  createFolder: async (accountId: string, parentFolderId: string, folderName: string): Promise<any> => {
    return await invoke("create_folder", { account_id: accountId, parent_folder_id: parentFolderId, folder_name: folderName });
  },

  deleteFile: async (accountId: string, fileId: string): Promise<boolean> => {
    try { await invoke("delete_file", { account_id: accountId, file_id: fileId }); return true; } catch { return false; }
  },

  mountPoolDrive: async (mountpoint?: string): Promise<{ success: boolean; mountpoint: string }> => {
    const res: string = await invoke("mount_pool_drive", { mountpoint: mountpoint || null });
    return { success: true, mountpoint: res };
  },

  unmountPoolDrive: async (): Promise<boolean> => {
    return await invoke("unmount_pool_drive");
  },

  getMountStatus: async (): Promise<{ mounted: boolean; mountpoint: string }> => {
    return await invoke("get_mount_status");
  },

  // Stub -- native file picker not wired yet.
  selectJsonFile: async (): Promise<{ content: string; filePath: string } | null> => {
    return null;
  },
};
