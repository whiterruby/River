// Default OAuth credentials config and app info. Credentials are stored in OS keyring.
import React, { useState, useEffect } from 'react';
import { useDriveStore } from '../store';
import { Key, Shield, Check } from 'lucide-react';
import { t } from '../locales';
import { driveApi } from '../api';

export const SettingsView: React.FC = () => {
  const { getSettings, setSetting, language } = useDriveStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // Brief flash state for save confirmation
  const [saved, setSaved] = useState(false);

  // Load persisted OAuth creds on mount
  useEffect(() => {
    getSettings().then((s: Record<string, string>) => {
      if (s.default_client_id) setClientId(s.default_client_id);
      if (s.default_client_secret) setClientSecret(s.default_client_secret);
    });
  }, []);

  const handleSave = async () => {
    await setSetting('default_client_id', clientId.trim());
    await setSetting('default_client_secret', clientSecret.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent p-6 gap-6 max-w-3xl overflow-y-auto">
      <div>
        <h1 className="font-serif text-[24px] font-medium text-ink">{t('settings_title', language)}</h1>
        <p className="text-sm text-muted mt-1 leading-relaxed">{t('settings_desc', language)}</p>
      </div>

      {/* OAuth credentials card */}
      <div className="bg-cardBg backdrop-blur-xl border border-transparent rounded-[24px] p-6 space-y-5 shadow-mirai">
        <div className="flex items-center gap-2 pb-3 border-b border-transparent">
          <span className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center"><Key className="w-4 h-4 text-moss" /></span>
          <h2 className="font-serif text-[16px] font-medium text-ink">Google OAuth</h2>
          <span className="ml-auto text-[11px] px-2.5 py-1 rounded-full bg-cream border border-line text-muted">Optional</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">Client ID</label>
          <input type="text" value={clientId} onChange={(e)=>setClientId(e.target.value)} placeholder="xxxxx.apps.googleusercontent.com" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/40 font-mono" />
          <p className="text-[11px] text-muted mt-1.5">Leave empty to be prompted each time. Saved securely on device.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">Client Secret</label>
          <input type="password" value={clientSecret} onChange={(e)=>setClientSecret(e.target.value)} placeholder="GOCSPX-xxxxx" className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/40 font-mono" />
        </div>
        <div className="pt-2 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-muted flex items-center gap-1.5 max-w-md"><Shield className="w-3.5 h-3.5 text-moss shrink-0" /> {t('security_notice', language)}</span>
          <button onClick={handleSave} className="px-5 py-2.5 bg-ink text-paper rounded-full text-sm font-medium hover:opacity-90 transition flex items-center gap-2">
            {saved && <Check className="w-4 h-4" />} {saved ? t('saved_success', language) : t('save', language)}
          </button>
        </div>
      </div>

      {/* App branding / about card */}
      <div className="bg-cardBg backdrop-blur-xl border border-transparent rounded-[24px] p-6 shadow-mirai">
        <h3 className="font-serif text-sm font-medium text-ink mb-2">River</h3>
        <p className="text-xs text-muted leading-relaxed">River — Designed by whiteruby. Drip Dom, Perignon, Pharaoh, Gizah.</p>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
          <span className="px-2.5 py-1 rounded-full bg-cream border border-transparent">v1.0</span>
          <span className="px-2.5 py-1 rounded-full bg-cream border border-transparent">Tauri</span>
          <span className="px-2.5 py-1 rounded-full bg-cream border border-transparent">AES-256-GCM + OS keyring</span>
        </div>
      </div>

      <button
        onClick={() => driveApi.openExternalUrl('https://buymeacoffee.com/whiteruby')}
        className="overflow-hidden rounded-[20px] border-0 shadow-mirai hover:shadow-miraiHover hover:opacity-[0.98] transition block w-full bg-cardBg p-2 flex items-center justify-center"
        title="Buy me a coffee — https://buymeacoffee.com/whiteruby"
      >
        <img src="/buymeacoffee.webp" alt="Buy me a coffee — whiteruby" className="w-full h-auto max-h-[260px] object-contain rounded-[12px] block mx-auto" loading="lazy" />
      </button>
    </div>
  );
};
