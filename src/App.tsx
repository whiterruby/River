// Root shell: sidebar nav, pool summary widget, and view routing.
import React, { useEffect } from 'react';
import { useDriveStore } from './store';
import { AccountsView } from './components/AccountsView';
import { SearchView } from './components/SearchView';
import { FilesView } from './components/FilesView';
import { SettingsView } from './components/SettingsView';
import { RefreshCw } from 'lucide-react';
import {
  RiverLeafLogo,
  MapleLeafIcon,
  WindLeafIcon,
  BranchIcon,
  AcornIcon,
  FallingLeafIcon,
  SunIcon,
  MoonIcon,
} from './components/AutumnIcons';
import { t } from './locales';
import { driveApi } from './api';

/** Human-readable byte string (e.g. 4.12 GB). Clamped to EB so huge pools never overflow. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function App() {
  const {
    accounts,
    poolSummary,
    isLoading,
    activeTab,
    setActiveTab,
    refreshAllQuotas,
    language,
    setLanguage,
    theme,
    toggleTheme,
    setTheme,
    loadAccounts,
    loadPoolSummary,
  } = useDriveStore();

  // Bootstrap: load persisted settings then hydrate accounts + pool.
  // Note: <html> already carries class="dark" from index.html, and setTheme
  // keeps it in sync below, so no manual class toggle is needed here.
  useEffect(() => {
    loadAccounts();
    loadPoolSummary();
    driveApi.getSettings().then((s) => {
      const lang = s.app_language as 'tr' | 'en' | 'ru';
      if (lang && ['tr','en','ru'].includes(lang)) {
        useDriveStore.setState({ language: lang });
      }
      const savedTheme = s.app_theme as 'light' | 'dark';
      if (savedTheme && ['light','dark'].includes(savedTheme)) {
        setTheme(savedTheme);
      } else {
        setTheme('dark');
      }
    });
  }, []);

  // Clamp to 0-100 so the progress bar never overflows and NaN can't leak into styles.
  const rawPct = Number(poolSummary.used_percentage);
  const usedPct = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 0;

  return (
    <div className="relative flex h-screen w-screen bg-transparent text-ink font-sans select-none overflow-hidden">
      {/* Blurred background image */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <img
          src="/river-bg.webp"
          alt=""
          className="w-full h-full object-cover scale-105 blur-[10px] opacity-70 dark:opacity-45"
        />
        <div className="absolute inset-0 bg-[#ECE2D0]/10 dark:bg-[#0F0E0D]/35" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#ECE2D0]/8 via-transparent to-[#D8C9B0]/14 dark:from-[#1C1A17]/10 dark:via-transparent dark:to-[#2A1F14]/10" />
      </div>

      {/* ---- Sidebar ---- */}
      <div className="w-[280px] border-r border-line bg-sidebarBg backdrop-blur-2xl flex flex-col justify-between shrink-0 shadow-lg relative z-10">
        <div>
          <div className="p-6 border-b border-line flex items-center gap-3.5">
            <div className="w-[52px] h-[52px] rounded-[18px] bg-gradient-to-br from-amberMirai to-terracotta flex items-center justify-center shadow-mirai relative overflow-hidden shrink-0">
              <div className="absolute inset-0 bg-white/10 rounded-[18px]" />
              <RiverLeafLogo className="text-white relative z-10" size={36} />
              <div className="absolute inset-[7px] border border-white/20 rounded-[12px]" />
            </div>
            <div className="flex flex-col">
              <h1 className="font-serif font-semibold text-[22px] leading-none tracking-tight text-ink">River</h1>
              <p className="text-[11px] tracking-[0.14em] text-muted font-medium mt-0.5 uppercase">Designed by whiteruby</p>
            </div>
          </div>

          {/* Language switcher + theme toggle */}
          <div className="px-5 pt-4 pb-2 flex items-center gap-2">
            <div className="inline-flex items-center bg-cream backdrop-blur-md border border-line rounded-full p-1 gap-0.5">
              {(['tr','en','ru'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLanguage(l)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide transition-all ${
                    language === l
                      ? 'bg-ink text-paper shadow-sm'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {l === 'tr' ? 'TR' : l === 'en' ? 'EN' : 'RU'}
                </button>
              ))}
            </div>
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full bg-cream backdrop-blur-md border border-line flex items-center justify-center text-muted hover:text-amberMirai transition-all"
              title={theme === 'light' ? 'Dark mode' : 'Light mode'}
            >
              {theme === 'light' ? <MoonIcon size={14} /> : <SunIcon size={14} />}
            </button>
          </div>

          {/* Tab navigation */}
          <nav className="px-3 py-3 space-y-1.5">
            <button
              onClick={() => setActiveTab('pool')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-all border ${
                activeTab === 'pool'
                  ? 'bg-cardBg border-amberMirai text-ink shadow-sm backdrop-blur-md'
                  : 'border-transparent text-muted hover:bg-cream hover:text-ink'
              }`}
            >
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${activeTab==='pool' ? 'bg-amberMirai text-white' : 'bg-line text-moss'}`}>
                <MapleLeafIcon size={18} />
              </span>
              <span className="truncate">{t('tab_accounts', language)}</span>
              <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${activeTab==='pool' ? 'bg-cardBg border-line text-muted' : 'bg-cream border-line text-muted'}`}>{accounts.length}</span>
            </button>

            <button
              onClick={() => setActiveTab('search')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-all border ${
                activeTab === 'search'
                  ? 'bg-cardBg border-amberMirai text-ink shadow-sm backdrop-blur-md'
                  : 'border-transparent text-muted hover:bg-cream hover:text-ink'
              }`}
            >
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${activeTab==='search' ? 'bg-amberMirai text-white' : 'bg-line text-moss'}`}>
                <WindLeafIcon size={18} />
              </span>
              <span>{t('tab_search', language)}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('files');
                // Auto-select first active account so the file browser isn't empty.
                const active = accounts.find((a) => a.is_enabled && a.status === 'active') || accounts[0];
                if (active) {
                  useDriveStore.getState().selectAccount(active.id);
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-all border ${
                activeTab === 'files'
                  ? 'bg-cardBg border-amberMirai text-ink shadow-sm backdrop-blur-md'
                  : 'border-transparent text-muted hover:bg-cream hover:text-ink'
              }`}
            >
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${activeTab==='files' ? 'bg-amberMirai text-white' : 'bg-line text-moss'}`}>
                <BranchIcon size={18} />
              </span>
              <span>{t('tab_files', language)}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px] font-medium transition-all border ${
                activeTab === 'settings'
                  ? 'bg-cardBg border-amberMirai text-ink shadow-sm backdrop-blur-md'
                  : 'border-transparent text-muted hover:bg-cream hover:text-ink'
              }`}
            >
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${activeTab==='settings' ? 'bg-amberMirai text-white' : 'bg-line text-moss'}`}>
                <AcornIcon size={18} />
              </span>
              <span>{t('tab_settings', language)}</span>
            </button>
          </nav>

          <div className="px-6 pt-6 opacity-40">
            <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-line to-transparent" />
            <p className="font-serif text-[10px] tracking-[0.18em] text-muted/60 text-center mt-3 uppercase">— river —</p>
          </div>
        </div>

        {/* Pool summary card (sidebar footer) */}
        <div className="p-5">
          <div className="bg-cardBg backdrop-blur-xl border border-line rounded-[20px] p-4 shadow-mirai">
            <div className="flex justify-between items-center mb-2.5">
              <span className="text-[11px] tracking-[0.12em] text-muted uppercase font-semibold flex items-center gap-1.5">
                <MapleLeafIcon size={13} className="text-terracotta" />
                {t('total_storage', language)}
              </span>
              <span className="text-[12px] font-semibold text-terracotta bg-cardBg border border-line px-2 py-0.5 rounded-full">{usedPct.toFixed(1)}%</span>
            </div>
            {/* Progress bar: color shifts at 75% and 90% thresholds */}
            <div className="relative w-full">
              <div className="w-full h-[8px] bg-paperDeep border border-line rounded-full overflow-hidden p-[2px]">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    usedPct > 90
                      ? 'bg-terracotta'
                      : usedPct > 75
                      ? 'bg-amberDeep'
                      : 'bg-gradient-to-r from-amberMirai to-terracotta'
                  }`}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              {usedPct > 3 && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `calc(${usedPct}% - 6px)` }}
                >
                  <FallingLeafIcon size={16} className="text-terracotta drop-shadow-sm" />
                </div>
              )}
            </div>
            <div className="flex justify-between text-[11px] text-muted mt-2.5 font-medium">
              <span>{t('quota_used', language)}: {formatBytes(poolSummary.used_quota)}</span>
              <span>{t('quota_total', language)}: {formatBytes(poolSummary.total_quota)}</span>
            </div>
            <button
              onClick={() => refreshAllQuotas()}
              disabled={isLoading}
              className="w-full mt-3.5 flex items-center justify-center gap-1.5 py-2.5 bg-ink hover:opacity-90 text-paper rounded-full text-xs font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{t('refresh_all', language)}</span>
            </button>
          </div>
          <p className="text-[10px] text-muted/50 text-center mt-3 tracking-wide">River v1.0 — whiteruby</p>
        </div>
      </div>

      {/* ---- Main content area: conditional view render ---- */}
      <div className="flex-1 flex flex-col overflow-hidden bg-transparent relative z-10">
        {activeTab === 'pool' && <AccountsView />}
        {activeTab === 'search' && <SearchView />}
        {activeTab === 'files' && <FilesView />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  );
}
