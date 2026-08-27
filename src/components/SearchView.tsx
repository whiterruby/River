// Cross-account file search with filter (all/file/folder) and inline preview support.
import React, { useState } from 'react';
import { useDriveStore } from '../store';
import {
  Search,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Download,
  Eye,
  Sparkles,
} from 'lucide-react';
import { driveApi } from '../api';
import { t } from '../locales';
import type { DriveFile } from '../types';
import { FilePreviewModal } from './FilePreviewModal';
import {
  AutumnFolderIcon,
  AutumnFileIcon,
  AutumnPdfIcon,
  AutumnTextIcon,
  AutumnVideoIcon,
  AutumnMusicIcon,
  AutumnImageIcon,
} from './AutumnIcons';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Simplified icon / thumbnail resolver for search results
function getSearchFileIcon(file: DriveFile, size: number) {
  const mime = file.mime_type || '';
  if (file.thumbnail_link && (mime.startsWith('image/') || mime.startsWith('video/'))) {
    return (
      <img
        src={file.thumbnail_link}
        alt=""
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover rounded-xl"
        onError={(e) => {
          (e.target as HTMLElement).style.display = 'none';
        }}
      />
    );
  }
  if (mime === FOLDER_MIME) return <AutumnFolderIcon size={size} className="text-fileIcon" />;
  if (mime.includes('pdf')) return <AutumnPdfIcon size={size} className="text-fileIcon" />;
  if (mime.startsWith('video/')) return <AutumnVideoIcon size={size} className="text-fileIcon" />;
  if (mime.startsWith('audio/')) return <AutumnMusicIcon size={size} className="text-fileIcon" />;
  if (mime.startsWith('image/')) return <AutumnImageIcon size={size} className="text-fileIcon" />;
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('google-apps.document') || mime.includes('google-apps.spreadsheet') || mime.includes('google-apps.presentation')) return <AutumnTextIcon size={size} className="text-fileIcon" />;
  return <AutumnFileIcon size={size} className="text-fileIcon" />;
}

export const SearchView: React.FC = () => {
  const { searchResult, searchQuery, searchFilter, isSearching, searchGlobal, language } = useDriveStore();
  const [inputQuery, setInputQuery] = useState(searchQuery);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  const handleOpenLocal = (file: DriveFile) => {
    setPreviewFile(file);
  };
  const handleDownload = async (file: DriveFile) => {
    const accountId = file.account_id;
    if (!accountId) return;
    setDownloadingId(file.id);
    try {
      const res: any = await driveApi.downloadFile(accountId, file.id, file.name, file.mime_type);
      if (res?.filePath) console.log("[river] saved to", res.filePath);
    } finally { setDownloadingId(null); }
  };
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchGlobal(inputQuery.trim(), searchFilter as any);
  };

  // Fetch all files on first mount if no previous search exists
  React.useEffect(() => {
    if (!searchResult && !isSearching) {
      searchGlobal('', 'all');
    }
  }, []);
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(text);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 gap-4 bg-transparent">
      {/* Search bar + type filter toggle */}
      <div className="bg-cardBg border border-line rounded-[20px] p-3 flex items-center gap-3 shadow-mirai">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={t('search_placeholder', language)}
            className="w-full bg-cream border border-line rounded-full pl-9 pr-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/40 focus:bg-cardBg transition"
          />
        </form>
        <div className="flex items-center gap-1 bg-cream border border-line rounded-full p-1">
          {(['all', 'file', 'folder'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => { searchGlobal(inputQuery.trim(), filter); }}
              className={`px-3.5 py-1.5 text-xs rounded-full font-medium transition ${searchFilter === filter ? 'bg-ink text-paper shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {filter === 'all' ? t('all_files_filter', language) : filter === 'file' ? t('only_files', language) : t('only_folders', language)}
            </button>
          ))}
        </div>
      </div>

      {/* Result count + account count summary */}
      <div className="flex justify-between items-center px-1">
        <span className="text-xs text-muted font-medium flex items-center gap-1.5">
          {searchResult ? <><Sparkles className="w-3.5 h-3.5 text-amberMirai" /> {searchResult.total_found} {t('found_results', language)}</> : <span className="text-muted/60">{t('search_all_hint', language)}</span>}
        </span>
        {searchResult && searchResult.account_results.length > 0 && (
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-cardBg border border-line text-muted">{searchResult.account_results.length} {t('account_in', language)}</span>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-auto rounded-[20px] border border-transparent bg-cardBg backdrop-blur-xl shadow-mirai">
        {isSearching ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cream border border-line flex items-center justify-center"><RefreshCw className="w-6 h-6 text-amberMirai animate-spin" /></div>
            <p className="text-sm text-muted">{t('searching_hint', language)}</p>
          </div>
        ) : searchResult && searchResult.files.length > 0 ? (
          <div className="divide-y divide-transparent">
            {searchResult.files.map((file) => {
              const isFolder = file.mime_type === 'application/vnd.google-apps.folder';
              return (
                  <div key={`${file.account_id}-${file.id}`} className="p-3.5 flex items-center justify-between hover:bg-cream/30 rounded-xl transition cursor-pointer" onClick={() => !isFolder && handleOpenLocal(file)}>
                  <div className="flex items-center gap-3 overflow-hidden flex-1">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border bg-cream border-transparent">
                      {getSearchFileIcon(file, 18)}
                    </span>
                    <div className="truncate flex-1">
                      <div className="text-sm font-medium text-ink truncate">{file.name}</div>
                      <div className="text-xs text-muted flex items-center gap-2">
                        <span>{isFolder ? t('folder', language) : formatBytes(file.size || 0)}</span>
                        <span className="w-1 h-1 rounded-full bg-line" />
                        <span>{file.modified_time?.slice(0, 10)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {/* Show which account owns this file */}
                    <span className="hidden md:inline-flex px-2.5 py-1 bg-cream border border-line text-moss rounded-full text-xs font-mono max-w-[160px] truncate">{file.account_email}</span>
                      <button onClick={(e)=>{e.stopPropagation(); file.account_email && handleCopy(file.account_email);}} className="w-7 h-7 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-ink" title={t('copy_email', language)}>
                      {copiedEmail === file.account_email ? <Check className="w-3.5 h-3.5 text-moss" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex items-center gap-1.5 ml-1">
                      {!isFolder && (
                        <button onClick={(e)=>{e.stopPropagation(); handleOpenLocal(file);}} className="w-8 h-8 rounded-full bg-cardBg border border-line text-moss hover:bg-sage hover:text-paper hover:border-sage transition flex items-center justify-center">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button disabled={downloadingId===file.id} onClick={(e)=>{e.stopPropagation(); handleDownload(file);}} className="w-8 h-8 rounded-full bg-ink text-paper hover:opacity-90 transition flex items-center justify-center disabled:opacity-50">
                        {downloadingId===file.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </button>
                      {file.web_view_link && (
                      <button onClick={(e)=>{e.stopPropagation(); driveApi.openExternalUrl(file.web_view_link!);}} className="w-8 h-8 rounded-full bg-cardBg border border-line text-muted hover:text-ink flex items-center justify-center">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-muted text-sm gap-2">
            <div className="w-14 h-14 rounded-2xl bg-cream border border-line flex items-center justify-center"><Search className="w-6 h-6 text-muted/40" /></div>
            <span>{searchQuery ? t('no_match', language) : t('no_search_yet', language)}</span>
          </div>
        )}
      </div>

      {previewFile && previewFile.account_id && (
        <FilePreviewModal
          file={previewFile}
          accountId={previewFile.account_id}
          language={language}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
