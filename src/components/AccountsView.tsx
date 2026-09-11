// Account pool management: add/remove Google accounts, import/export tokens, view storage quotas.
import React, { useState, useEffect } from 'react';
import { useDriveStore } from '../store';
import { t } from '../locales';
import { driveApi } from '../api';
import {
  Upload,
  Download,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  FolderOpen,
  X,
  FileText,
  Key,
  ExternalLink,
  Lock,
  Sparkles,
  HardDrive,
  Power,
} from 'lucide-react';
import { StorageCrestIcon, FallingLeafIcon } from './AutumnIcons';
import type { DriveAccount } from '../types';

export const AccountsView: React.FC = () => {
  const {
    accounts,
    poolSummary,
    selectedAccountId,
    isLoading,
    loadAccounts,
    loadPoolSummary,
    selectAccount,
    refreshAccountQuota,
    refreshAllQuotas,
    toggleAccountEnabled,
    deleteAccount,
    updateAccountLabel,
    importAccounts,
    exportAccounts,
    startOAuthLogin,
    getSettings,
    setSetting,
    language,
    mountStatus,
    loadMountStatus,
    mountPoolDrive,
    unmountPoolDrive,
  } = useDriveStore();

  const [mounting, setMounting] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [exportJson, setExportJson] = useState('');
  const [copiedExport, setCopiedExport] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingImportList, setPendingImportList] = useState<any[] | null>(null);
  const [overwriteEmails, setOverwriteEmails] = useState<string[]>([]);
  // Toggle between default OAuth flow and user-provided credentials
  const [useCustomOAuth, setUseCustomOAuth] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [oauthScope, setOauthScope] = useState<'full' | 'readonly'>('full');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthSuccess, setOauthSuccess] = useState<string | null>(null);
  // Encrypted export/import
  const [exportMode, setExportMode] = useState<'plain' | 'encrypted'>('encrypted');
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');

  // Pre-fill custom OAuth fields from saved settings if available
  useEffect(() => {
    loadMountStatus();
    getSettings().then((settings: Record<string, string>) => {
      if (settings.default_client_id) {
        setClientId(settings.default_client_id);
        setUseCustomOAuth(true);
      }
      if (settings.default_client_secret) setClientSecret(settings.default_client_secret);
    });
  }, []);

  const handleToggleMount = async () => {
    setMounting(true);
    setMountError(null);
    try {
      if (mountStatus.mounted) {
        await unmountPoolDrive();
      } else {
        await mountPoolDrive();
      }
      await loadMountStatus();
    } catch (err: any) {
      setMountError(err?.message || String(err));
    } finally {
      setMounting(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Runs the full OAuth flow: PKCE + state, 127.0.0.1 ephemeral, scope selectable
  const handleStartOAuth = async () => {
    setOauthLoading(true);
    setOauthError(null);
    setOauthSuccess(null);
    const effectiveClientId = useCustomOAuth ? clientId.trim() : '';
    const effectiveClientSecret = useCustomOAuth ? clientSecret.trim() : '';
    if (useCustomOAuth && (!effectiveClientId || !effectiveClientSecret)) {
      setOauthError(language === 'tr' ? 'Client ID ve Secret gerekli.' : language === 'ru' ? 'Нужен Client ID и Secret.' : 'Client ID and Secret required.');
      setOauthLoading(false);
      return;
    }
    if (useCustomOAuth) {
      await setSetting('default_client_id', effectiveClientId);
      await setSetting('default_client_secret', effectiveClientSecret);
    }
    const scopes = oauthScope === 'readonly'
      ? ["openid","https://www.googleapis.com/auth/userinfo.email","https://www.googleapis.com/auth/userinfo.profile","https://www.googleapis.com/auth/drive.readonly"]
      : ["openid","https://www.googleapis.com/auth/userinfo.email","https://www.googleapis.com/auth/userinfo.profile","https://www.googleapis.com/auth/drive"];
    try {
      const res = await startOAuthLogin(effectiveClientId, effectiveClientSecret, scopes);
      setOauthSuccess(`${res.email} ${t('saved_success', language)}`);
      await loadAccounts();
      await loadPoolSummary();
      setTimeout(() => { setShowOAuthModal(false); setOauthSuccess(null); }, 2000);
    } catch (err: any) {
      setOauthError(err.message || 'OAuth failed');
    } finally { setOauthLoading(false); }
  };

  const handleExport = async () => {
    if (exportMode === 'encrypted') {
      if (exportPassword.length < 8) {
        setExportJson(language === 'tr' ? 'Şifre en az 8 karakter olmalı' : 'Password must be at least 8 characters');
        setShowExportModal(true);
        return;
      }
      try {
        const enc = await driveApi.exportAccountsEncrypted(exportPassword);
        setExportJson(enc);
      } catch (e: any) {
        setExportJson(`Export failed: ${e.message || e}`);
      }
    } else {
      const data = await exportAccounts();
      setExportJson(JSON.stringify(data, null, 2));
    }
    setShowExportModal(true);
  };
  // Trigger browser download of exported JSON / encrypted blob
  const handleDownloadExportFile = () => {
    const isEnc = exportJson.startsWith('RIVER_ENC_v1:');
    const ext = isEnc ? 'enc' : 'json';
    const mime = isEnc ? 'text/plain' : 'application/json';
    const blob = new Blob([exportJson], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `river_accounts_${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click(); URL.revokeObjectURL(url);
  };
  // Parse and import - with overwrite confirmation and validation
  const handleImportSubmit = async () => {
    try {
      setImportStatus(null);
      const trimmed = importJson.trim();
      // Support both v1 and v2 encrypted
      if (trimmed.startsWith('RIVER_ENC_v1:') || trimmed.startsWith('RIVER_ENC_v2:')) {
        if (importPassword.length < 8) {
          setImportStatus(language === 'tr' ? 'Şifreli yedek için şifre gerekli (≥8)' : 'Password required for encrypted backup (≥8)');
          return;
        }
        const res = await driveApi.importAccountsEncrypted(trimmed, importPassword);
        setImportStatus(`${res.imported} new, ${res.updated} updated, ${res.failed} failed`);
        await loadAccounts();
        await loadPoolSummary();
        if (res.failed === 0) setTimeout(() => { setShowImportModal(false); setImportJson(''); setImportPassword(''); setImportStatus(null); }, 1200);
        return;
      }
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      // Validation: check for existing emails before silent overwrite
      const existingEmails = new Set(accounts.map(a => a.email.toLowerCase()));
      const overlapping = list.map((i:any) => (i.email||'').toLowerCase()).filter((e:string) => existingEmails.has(e));
      if (overlapping.length > 0 && !pendingImportList) {
        setOverwriteEmails(overlapping);
        setPendingImportList(list);
        setShowOverwriteConfirm(true);
        return;
      }
      const actualList = pendingImportList || list;
      const res = await importAccounts(actualList as any);
      setImportStatus(`${res.imported} new, ${res.updated} updated, ${res.failed} failed`);
      await loadAccounts();
      await loadPoolSummary();
      if (res.failed === 0) {
        setTimeout(() => { setShowImportModal(false); setImportJson(''); setImportPassword(''); setImportStatus(null); setPendingImportList(null); setShowOverwriteConfirm(false); }, 1200);
      } else {
        setPendingImportList(null);
      }
    } catch (e: any) { setImportStatus(`Invalid: ${e.message}`); setPendingImportList(null); }
  };
  // Allow dropping a .json file onto the textarea
  const handleFileDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => { if (ev.target?.result) setImportJson(ev.target.result as string); };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-transparent p-6 gap-6">
      {/* Header with action buttons */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] font-medium text-ink flex items-center gap-3">
            {t('pool_title', language)}
            <span className="text-[11px] tracking-[0.14em] px-3 py-1 rounded-full bg-cardBg border border-line text-muted font-sans font-semibold">{accounts.length} {t('account_in', language)}</span>
          </h1>
          <p className="text-[13px] text-muted mt-1 max-w-xl leading-relaxed">{t('pool_desc', language)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleToggleMount}
            disabled={mounting || accounts.length === 0}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-medium transition shadow-mirai ${
              mountStatus.mounted
                ? 'bg-moss text-paper hover:bg-moss/90'
                : 'bg-cardBg border border-line text-ink hover:bg-cream'
            } disabled:opacity-50`}
            title={mountStatus.mounted ? `${t('mount_path_label', language)}: ${mountStatus.mountpoint}` : ''}
          >
            {mountStatus.mounted ? <Power className="w-4 h-4 text-paper" /> : <HardDrive className="w-4 h-4 text-moss" />}
            <span>
              {mounting
                ? (language === 'tr' ? 'İşleniyor...' : 'Processing...')
                : mountStatus.mounted
                ? t('unmount_drive_btn', language)
                : t('mount_drive_btn', language)}
            </span>
          </button>
          <button onClick={() => setShowOAuthModal(true)} className="flex items-center gap-2 px-5 py-2.5 bg-ink text-paper rounded-full text-[13px] font-medium hover:opacity-90 transition shadow-mirai">
            <Plus className="w-4 h-4" /> {t('google_oauth_btn', language)}
          </button>
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2.5 bg-cardBg border border-line text-ink rounded-full text-[13px] font-medium hover:bg-cream transition">
            <Upload className="w-4 h-4 text-moss" /> {t('import_json_btn', language)}
          </button>
          <button onClick={handleExport} disabled={accounts.length===0} className="flex items-center gap-2 px-4 py-2.5 bg-cardBg border border-line text-ink rounded-full text-[13px] font-medium hover:bg-cream transition disabled:opacity-50">
            <Download className="w-4 h-4 text-terracotta" /> {t('export_json_btn', language)}
          </button>
          <button onClick={() => refreshAllQuotas()} disabled={isLoading || accounts.length===0} className="flex items-center gap-2 px-4 py-2.5 bg-cardBg border border-line text-ink rounded-full text-[13px] font-medium hover:bg-cream transition disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-amberDeep ${isLoading ? 'animate-spin' : ''}`} /> {t('refresh_quotas_btn', language)}
          </button>
        </div>
      </div>

      {/* Aggregate pool storage bar with stats */}
      <div className="bg-cardBg backdrop-blur-xl border border-line rounded-[24px] p-5 shadow-mirai">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-paperDeep border border-line flex items-center justify-center"><StorageCrestIcon size={16} className="text-moss" /></span>
            <h2 className="font-serif text-[16px] font-medium text-ink">{t('pool_storage_title', language)}</h2>
          </div>
          <div className="text-sm text-ink">
            <span className="font-semibold text-terracotta">{formatBytes(poolSummary.used_quota)}</span> <span className="text-muted">/ {formatBytes(poolSummary.total_quota)}</span>
            <span className="ml-2 text-xs px-2.5 py-1 rounded-full bg-paperDeep border border-line text-muted">{poolSummary.used_percentage.toFixed(1)}%</span>
          </div>
        </div>
        {/* Progress bar with leaf indicator at current position */}
        <div className="relative w-full">
          <div className="w-full bg-cream h-[10px] rounded-full overflow-hidden p-0.5 border border-transparent">
            <div className={`h-full rounded-full transition-all duration-700 ${poolSummary.used_percentage > 90 ? 'bg-terracotta' : poolSummary.used_percentage > 75 ? 'bg-amberDeep' : 'bg-gradient-to-r from-amberMirai to-terracotta'}`} style={{ width: `${Math.min(poolSummary.used_percentage || 0, 100)}%` }} />
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-700" style={{ left: `${Math.min(poolSummary.used_percentage || 0, 100)}%`, marginLeft: '-2px' }}>
            <FallingLeafIcon size={20} className="text-terracotta drop-shadow-sm" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-transparent">
          {[
            { label: t('active_accounts_label', language), value: `${poolSummary.active_accounts} / ${poolSummary.total_accounts}`, color: 'text-ink' },
            { label: t('used_space_label', language), value: formatBytes(poolSummary.used_quota), color: 'text-terracotta' },
            { label: t('free_space_label', language), value: formatBytes(poolSummary.free_quota), color: 'text-moss' },
            { label: t('invalid_label', language), value: `${poolSummary.invalid_accounts}`, color: 'text-amberDeep' },
          ].map((s) => (
            <div key={s.label}>
              <span className="text-[11px] tracking-wide text-muted uppercase">{s.label}</span>
              <p className={`text-[15px] font-semibold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {mountError && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 rounded-2xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{mountError}</span>
          <button onClick={() => setMountError(null)} className="ml-auto shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {deleteWarning && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{deleteWarning}</span>
          <button onClick={()=>setDeleteWarning(null)} className="ml-auto shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {/* Account cards grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {accounts.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-line rounded-[24px] bg-cardBg/60 p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-paperDeep border border-line flex items-center justify-center mb-3"><Key className="w-7 h-7 text-moss" /></div>
            <h3 className="font-serif text-lg text-ink">{t('no_accounts_title', language)}</h3>
            <p className="text-sm text-muted max-w-md mt-1 mb-4">{t('no_accounts_desc', language)}</p>
            <div className="flex gap-2">
              <button onClick={() => setShowOAuthModal(true)} className="px-5 py-2.5 bg-ink text-paper rounded-full text-sm font-medium">{t('google_oauth_btn', language)}</button>
              <button onClick={() => setShowImportModal(true)} className="px-5 py-2.5 bg-cardBg border border-line text-ink rounded-full text-sm">{t('import_json_btn', language)}</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acc: DriveAccount) => {
              const usedPercent = acc.quota_total > 0 ? Math.round((acc.quota_used / acc.quota_total) * 100) : 0;
              const isSelected = selectedAccountId === acc.id;
              return (
                <div key={acc.id} className={`bg-cardBg backdrop-blur-md border rounded-[20px] p-4 flex flex-col justify-between shadow-mirai hover:shadow-miraiHover transition ${isSelected ? 'border-amberMirai/40' : 'border-line'}`}>
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {acc.avatar_url ? <img src={acc.avatar_url} alt="" className="w-9 h-9 rounded-full border border-line object-cover" /> : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blush to-paperDeep border border-line text-moss font-semibold flex items-center justify-center text-xs">{acc.email.slice(0,2).toUpperCase()}</div>}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{acc.email}</p>
                          {editingLabelId === acc.id ? (
                            <div className="flex items-center gap-1 mt-1">
                              <input type="text" value={labelInput} onChange={(e)=>setLabelInput(e.target.value)} className="bg-cream border border-amberMirai/30 rounded-full px-2.5 py-1 text-xs outline-none w-28" autoFocus />
                              <button onClick={async()=>{await updateAccountLabel(acc.id, labelInput); setEditingLabelId(null);}} className="w-6 h-6 rounded-full bg-ink text-paper flex items-center justify-center text-xs">✓</button>
                            </div>
                          ) : (
                            <p onClick={()=>{setEditingLabelId(acc.id); setLabelInput(acc.label||'');}} className="text-xs text-muted hover:text-ink cursor-pointer truncate">{acc.label || t('edit_label', language)}</p>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] px-2.5 py-1 rounded-full border font-medium ${acc.status==='active' ? 'bg-sage/15 text-moss border-sage/20' : 'bg-terracotta/10 text-terracotta border-terracotta/15'}`}>{acc.status==='active' ? t('status_active', language) : t('status_invalid', language)}</span>
                    </div>
                    {/* Per-account quota bar */}
                    <div className="mt-4 space-y-1.5">
                      <div className="flex justify-between text-xs text-muted"><span>{t('storage_label', language)}</span><span className="font-medium text-ink">{formatBytes(acc.quota_used)} / {formatBytes(acc.quota_total)}</span></div>
                      <div className="w-full bg-cream h-[6px] rounded-full overflow-hidden border border-transparent">
                        <div className={`h-full rounded-full ${usedPercent > 90 ? 'bg-terracotta' : usedPercent > 70 ? 'bg-amberDeep' : 'bg-amberMirai'}`} style={{ width: `${Math.min(usedPercent,100)}%` }} />
                      </div>
                    </div>
                  </div>
                  {/* Card actions: browse files, refresh quota, toggle enabled, delete */}
                  <div className="flex items-center justify-between pt-3 mt-4 border-t border-transparent text-xs">
                    <button onClick={()=>selectAccount(acc.id)} className="text-ink hover:text-terracotta font-medium flex items-center gap-1.5 bg-cream hover:bg-blush px-3 py-1.5 rounded-full border border-line transition"><FolderOpen className="w-3.5 h-3.5" /> {t('files_btn', language)}</button>
                    <div className="flex items-center gap-1">
                      <button onClick={()=>refreshAccountQuota(acc.id)} title={t('quota_refresh', language)} className="w-7 h-7 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-ink hover:border-amberMirai/30 transition"><RefreshCw className="w-3.5 h-3.5" /></button>
                      <button onClick={()=>toggleAccountEnabled(acc.id, !acc.is_enabled)} title={acc.is_enabled ? t('disable_account', language) : t('enable_account', language)} className={`w-7 h-7 rounded-full border flex items-center justify-center transition ${acc.is_enabled ? 'bg-cardBg border-line text-muted hover:text-terracotta' : 'bg-sage/10 border-sage/20 text-moss'}`}><Lock className="w-3.5 h-3.5" /></button>
                      <button onClick={async ()=>{
                        const res:any = await deleteAccount(acc.id);
                        if (res?.warning) {
                          setDeleteWarning(res.warning);
                          setTimeout(()=>setDeleteWarning(null), 8000);
                        }
                      }} title={t('delete_account_btn', language)} className="w-7 h-7 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-terracotta hover:border-terracotta/20 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* OAuth login modal */}
      {showOAuthModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-cardBg border border-line rounded-[24px] w-full max-w-lg overflow-hidden shadow-mirai">
            <div className="flex items-center justify-between p-5 border-b border-transparent">
              <h3 className="font-serif text-lg text-ink flex items-center gap-2"><span className="w-8 h-8 rounded-full bg-paperDeep border border-line flex items-center justify-center"><Key className="w-4 h-4 text-moss" /></span> {t('oauth_modal_title', language)}</h3>
              <button onClick={()=>setShowOAuthModal(false)} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted hover:text-ink"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              {!useCustomOAuth ? (
                <div className="space-y-4">
                  <div className="bg-cream border border-line rounded-2xl p-5 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-cardBg border border-line flex items-center justify-center mx-auto"><Sparkles className="w-6 h-6 text-amberMirai" /></div>
                    <div>
                      <h4 className="text-sm font-medium text-ink">{t('google_oauth_btn', language)}</h4>
                      <p className="text-xs text-muted mt-1 max-w-xs mx-auto leading-relaxed">{t('oauth_quick_desc', language)}</p>
                    </div>
                  </div>
                  <div className="bg-cream/60 border border-line rounded-2xl p-3 space-y-2">
                    <p className="text-xs font-medium text-ink">Drive access</p>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" checked={oauthScope==='readonly'} onChange={()=>setOauthScope('readonly')} className="accent-amberMirai" />
                      <span className="text-ink">Read only</span><span className="text-muted">— browse & download only</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" checked={oauthScope==='full'} onChange={()=>setOauthScope('full')} className="accent-amberMirai" />
                      <span className="text-ink">Read & write</span><span className="text-muted">— upload / modify / delete</span>
                    </label>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>PKCE + 127.0.0.1 ephemeral <span className="ml-1 px-1.5 py-0.5 rounded-full bg-sage/10 border border-sage/20 text-moss text-[10px]">secure</span></span>
                    <button onClick={()=>setUseCustomOAuth(true)} className="text-muted hover:text-ink underline decoration-dotted text-xs">{t('oauth_use_custom', language)}</button>
                  </div>
                </div>
              ) : (
                /* Custom OAuth credentials form */
                <div className="space-y-4">
                  <div className="flex items-center justify-between"><span className="text-xs font-medium text-amberDeep">{t('oauth_custom_title', language)}</span><button onClick={()=>setUseCustomOAuth(false)} className="text-xs text-terracotta hover:underline">{t('oauth_back_default', language)}</button></div>
                  <div>
                    <label className="block text-xs font-medium text-ink mb-1.5">{t('oauth_client_id', language)}</label>
                    <input type="text" value={clientId} onChange={(e)=>setClientId(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink mb-1.5">{t('oauth_client_secret', language)}</label>
                    <input type="password" value={clientSecret} onChange={(e)=>setClientSecret(e.target.value)} placeholder="GOCSPX-xxxxx" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/50" />
                  </div>
                  <div className="bg-cream/60 border border-line rounded-2xl p-3 space-y-2">
                    <p className="text-xs font-medium text-ink">Drive access</p>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" checked={oauthScope==='readonly'} onChange={()=>setOauthScope('readonly')} className="accent-amberMirai" />
                      <span>Read only</span><span className="text-muted">— drive.readonly</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="radio" checked={oauthScope==='full'} onChange={()=>setOauthScope('full')} className="accent-amberMirai" />
                      <span>Read & write</span><span className="text-muted">— drive (full)</span>
                    </label>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted pt-1">
                    <span>Redirect: <code className="text-ink bg-cream border border-line px-1.5 py-0.5 rounded-full">http://127.0.0.1/callback (ephemeral)</code></span>
                    <button onClick={()=>setShowHelpModal(true)} className="text-terracotta hover:underline flex items-center gap-1">{t('how_to_get', language)} <ExternalLink className="w-3 h-3" /></button>
                  </div>
                </div>
              )}
              {oauthError && <div className="p-3 bg-terracotta/10 border border-terracotta/15 text-terracotta rounded-2xl text-xs flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {oauthError}</div>}
              {oauthSuccess && <div className="p-3 bg-sage/15 border border-sage/20 text-moss rounded-2xl text-xs flex items-center gap-2"><Check className="w-4 h-4" /> {oauthSuccess}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 bg-cream/60 border-t border-transparent">
              <button onClick={()=>setShowOAuthModal(false)} className="px-4 py-2 text-sm text-muted hover:text-ink">{t('cancel', language)}</button>
              <button onClick={handleStartOAuth} disabled={oauthLoading} className="px-5 py-2.5 bg-ink text-paper rounded-full text-sm font-medium hover:opacity-90 transition flex items-center gap-2 disabled:opacity-50">
                {oauthLoading ? <><RefreshCw className="w-4 h-4 animate-spin" /> {t('oauth_waiting', language)}</> : <><Key className="w-4 h-4" /> {t('google_oauth_btn', language)}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OAuth setup help modal - step-by-step GCP instructions */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-cardBg border border-line rounded-[24px] w-full max-w-lg overflow-hidden shadow-mirai">
            <div className="flex items-center justify-between p-5 border-b border-transparent"><h3 className="font-serif text-base text-ink">{t('oauth_help_title', language)}</h3><button onClick={()=>setShowHelpModal(false)} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted"><X className="w-4 h-4" /></button></div>
            <div className="p-6 space-y-3 text-xs text-muted leading-relaxed max-h-[60vh] overflow-y-auto">
              <ol className="list-decimal pl-4 space-y-2">
                <li><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-terracotta hover:underline">Google Cloud Console</a>'a git, proje oluştur.</li>
                <li>APIs & Services → Google Drive API'yi etkinleştir.</li>
                <li>OAuth consent screen → External, app ismi ver, scope <code className="bg-cream border border-line px-1 rounded">.../auth/drive</code> veya <code className="bg-cream border border-line px-1 rounded">.../auth/drive.readonly</code> ekle, test user ekle.</li>
                <li>Credentials → Create Credentials → OAuth client ID → Desktop.</li>
                <li>Redirect URI: <code className="bg-cream border border-line px-1 rounded">http://127.0.0.1/callback</code> ve <code className="bg-cream border border-line px-1 rounded">http://localhost/callback</code> ekle (ephemeral port — Google loopback için portu ignore eder, PKCE zorunlu).</li>
                <li>Client ID / Secret'ı kopyala ve River'a yapıştır.</li>
                <li className="text-moss">River artık PKCE S256 + state ile 127.0.0.1 ephemeral port kullanır — 0.0.0.0 bind yok.</li>
              </ol>
            </div>
            <div className="p-4 bg-cream/50 border-t border-transparent text-right"><button onClick={()=>setShowHelpModal(false)} className="px-4 py-2 bg-ink text-paper rounded-full text-xs">{t('close', language)}</button></div>
          </div>
        </div>
      )}

      {/* Import accounts modal (plaintext or RIVER_ENC_v1) */}
      {showImportModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-cardBg border border-line rounded-[24px] w-full max-w-lg overflow-hidden shadow-mirai">
            <div className="flex items-center justify-between p-5 border-b border-transparent"><h3 className="font-serif text-lg text-ink flex items-center gap-2"><FileText className="w-5 h-5 text-moss" /> {t('import_json_title', language)}</h3><button onClick={()=>setShowImportModal(false)} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-muted">{t('or_paste_json', language)} — plaintext JSON veya <code className="bg-cream border border-line px-1 rounded">RIVER_ENC_v1:...</code> şifreli yedek.</p>
              <textarea value={importJson} onChange={(e)=>setImportJson(e.target.value)} onDrop={handleFileDrop} placeholder={`[\n  {\n    "email": "user@gmail.com",\n    "refresh_token": "1//0xxxx..."\n  }\n]`} rows={8} className="w-full bg-cream border border-line rounded-2xl p-3 text-xs font-mono text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/30 resize-none" />
              {(importJson.trim().startsWith('RIVER_ENC_v1:') || importJson.trim().startsWith('RIVER_ENC_v2:')) && (
                <div>
                  <label className="block text-xs font-medium text-ink mb-1.5">Backup password</label>
                  <input type="password" value={importPassword} onChange={(e)=>setImportPassword(e.target.value)} placeholder="≥8 characters" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/50" />
                </div>
              )}
              {importStatus && <div className={`p-3 rounded-2xl text-xs border ${importStatus.includes('new') ? 'bg-sage/10 border-sage/20 text-moss' : 'bg-terracotta/10 border-terracotta/15 text-terracotta'}`}>{importStatus}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 bg-cream/60 border-t border-transparent">
              <button onClick={()=>setShowImportModal(false)} className="px-4 py-2 text-sm text-muted hover:text-ink">{t('cancel', language)}</button>
              <button onClick={handleImportSubmit} disabled={!importJson.trim() || isLoading} className="px-5 py-2.5 bg-ink text-paper rounded-full text-sm font-medium disabled:opacity-50">{isLoading ? t('importing', language) : t('import', language)}</button>
            </div>
          </div>
        </div>
      )}

      {/* Overwrite confirmation */}
      {showOverwriteConfirm && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-cardBg border border-amber-200 rounded-[24px] w-full max-w-md overflow-hidden shadow-mirai">
            <div className="p-5 border-b border-amber-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-serif text-base text-ink">Overwrite existing account?</h3>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-muted">Existing account detected:</p>
              <div className="bg-cream border border-line rounded-2xl p-3 space-y-1">
                {overwriteEmails.map(e => (
                  <div key={e} className="text-xs font-mono text-ink flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /> {e}
                  </div>
                ))}
              </div>
              <p className="text-xs text-terracotta">Current credentials will be replaced by imported ones.</p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 bg-cream/60 border-t border-transparent">
              <button onClick={()=>{setShowOverwriteConfirm(false); setPendingImportList(null);}} className="px-4 py-2 text-sm text-muted hover:text-ink">Cancel</button>
              <button onClick={async ()=>{
                setShowOverwriteConfirm(false);
                if (pendingImportList) {
                  try {
                    const res = await importAccounts(pendingImportList as any);
                    setImportStatus(`${res.imported} new, ${res.updated} updated, ${res.failed} failed`);
                    await loadAccounts();
                    await loadPoolSummary();
                    if (res.failed === 0) setTimeout(()=>{ setShowImportModal(false); setImportJson(''); setImportPassword(''); setImportStatus(null); setPendingImportList(null); }, 1200);
                  } catch (e:any) { setImportStatus(`Invalid: ${e.message}`); setPendingImportList(null); }
                }
              }} className="px-5 py-2.5 bg-amber-600 text-white rounded-full text-sm font-medium">Overwrite</button>
            </div>
          </div>
        </div>
      )}

      {/* Export accounts modal - plain vs encrypted */}
      {showExportModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-cardBg border border-line rounded-[24px] w-full max-w-lg overflow-hidden shadow-mirai">
            <div className="flex items-center justify-between p-5 border-b border-transparent"><h3 className="font-serif text-lg text-ink flex items-center gap-2"><Download className="w-5 h-5 text-terracotta" /> {t('export_json_title', language)}</h3><button onClick={()=>setShowExportModal(false)} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                <button onClick={()=>setExportMode('encrypted')} className={`flex-1 py-2 rounded-full text-xs font-medium border ${exportMode==='encrypted' ? 'bg-ink text-paper border-ink' : 'bg-cream text-muted border-line'}`}>🔒 Encrypted (recommended)</button>
                <button onClick={()=>setExportMode('plain')} className={`flex-1 py-2 rounded-full text-xs font-medium border ${exportMode==='plain' ? 'bg-ink text-paper border-ink' : 'bg-cream text-muted border-line'}`}>Plaintext JSON</button>
              </div>
              {exportMode==='encrypted' ? (
                <div className="space-y-3">
                  <div className="p-3 bg-sage/10 border border-sage/20 rounded-2xl text-xs text-moss flex items-start gap-2"><Lock className="w-4 h-4 mt-0.5 shrink-0" /> {language==='tr' ? 'Şifreli yedek — şifre olmadan açılamaz.' : 'Encrypted backup — requires password to import.'}</div>
                  <input type="password" value={exportPassword} onChange={(e)=>setExportPassword(e.target.value)} placeholder="Backup password (≥8)" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/50" />
                  <button onClick={handleExport} disabled={exportPassword.length < 8} className="w-full py-2 bg-ink text-paper rounded-full text-xs font-medium disabled:opacity-50">Generate Encrypted Backup</button>
                </div>
              ) : (
                <div className="p-3 bg-blush border border-amberMirai/20 rounded-2xl text-xs text-ink flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amberDeep" /> {language==='tr' ? 'Plaintext — hassas anahtarlar düz metin! Sadece güvenli yerde sakla.' : 'Plaintext — sensitive keys! Keep it safe.'}</div>
              )}
              <textarea value={exportJson} readOnly rows={8} className="w-full bg-cream border border-line rounded-2xl p-3 text-xs font-mono text-ink focus:outline-none resize-none" placeholder={exportMode==='encrypted' ? 'Enter password then Generate' : ''} />
              {exportMode==='encrypted' && exportJson.startsWith('RIVER_ENC_v1:') && <p className="text-[11px] text-moss">✓ Encrypted — store safely. Import will ask for password.</p>}
            </div>
            <div className="flex items-center justify-between p-4 bg-cream/60 border-t border-transparent">
              <button onClick={()=>{navigator.clipboard.writeText(exportJson); setCopiedExport(true); setTimeout(()=>setCopiedExport(false),2000);}} className="flex items-center gap-1.5 px-3 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium">
                {copiedExport ? <Check className="w-3.5 h-3.5 text-moss" /> : <Copy className="w-3.5 h-3.5" />} {copiedExport ? t('saved_success', language) : t('copy_email', language)}
              </button>
              <div className="flex gap-2">
                <button onClick={()=>setShowExportModal(false)} className="px-4 py-2 text-sm text-muted">{t('close', language)}</button>
                <button onClick={handleDownloadExportFile} className="px-4 py-2 bg-terracotta text-paper rounded-full text-sm flex items-center gap-2"><Download className="w-4 h-4" /> {exportJson.startsWith('RIVER_ENC_v1:') ? 'ENC' : 'JSON'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
