// File browser with folder navigation, upload flow, and CRUD operations for Drive files.
import React, { useState } from 'react';
import { useDriveStore } from '../store';
import {
  ExternalLink,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Upload,
  FolderPlus,
  Trash2,
  Download,
  Eye,
  LayoutGrid,
  List,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { driveApi } from '../api';
import { t } from '../locales';
import type { DriveFile, DriveAccount } from '../types';
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
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// MIME prefix lists for icon resolution
const VIDEO_MIMES = ['video/'];
const AUDIO_MIMES = ['audio/'];
const IMAGE_MIMES = ['image/'];
const PDF_MIMES = ['application/pdf'];
const TEXT_MIMES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/x-sh', 'application/x-yaml'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Maps MIME type to the appropriate autumn-themed icon component or thumbnail
function getFileIcon(file: DriveFile, size: number) {
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
  if (PDF_MIMES.some(m => mime.includes(m))) return <AutumnPdfIcon size={size} className="text-fileIcon" />;
  if (VIDEO_MIMES.some(m => mime.startsWith(m))) return <AutumnVideoIcon size={size} className="text-fileIcon" />;
  if (AUDIO_MIMES.some(m => mime.startsWith(m))) return <AutumnMusicIcon size={size} className="text-fileIcon" />;
  if (IMAGE_MIMES.some(m => mime.startsWith(m))) return <AutumnImageIcon size={size} className="text-fileIcon" />;
  if (TEXT_MIMES.some(m => mime.startsWith(m) || mime.includes(m))) return <AutumnTextIcon size={size} className="text-fileIcon" />;
  if (mime.includes('google-apps.document') || mime.includes('google-apps.spreadsheet') || mime.includes('google-apps.presentation')) return <AutumnTextIcon size={size} className="text-fileIcon" />;
  return <AutumnFileIcon size={size} className="text-fileIcon" />;
}

export const FilesView: React.FC = () => {
  const {
    accounts,
    selectedAccountId,
    folderFiles,
    folderBreadcrumbs,
    isLoading,
    selectAccount,
    loadFolderFiles,
    navigateBreadcrumb,
    viewMode,
    setViewMode,
    language,
  } = useDriveStore();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteCandidate, setDeleteCandidate] = useState<DriveFile | null>(null);
  // 'random' means auto-pick an active account for upload
  const [uploadTargetAccount, setUploadTargetAccount] = useState<string>('random');
  // Upload wizard: step 1 = file select + account, step 2 = folder picker
  const [uploadStep, setUploadStep] = useState<number>(1);
  const [selectedFileObj, setSelectedFileObj] = useState<{ name: string; dataUrl: string } | null>(null);
  const [uploadFolderBreadcrumbs, setUploadFolderBreadcrumbs] = useState<Array<{ id: string; name: string }>>([{ id: 'root', name: 'Root' }]);
  const [uploadFolderFiles, setUploadFolderFiles] = useState<DriveFile[]>([]);
  const [loadingUploadFolders, setLoadingUploadFolders] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const currentFolderId = folderBreadcrumbs[folderBreadcrumbs.length - 1]?.id || 'root';

  // Auto-select first active account on mount, then load its root files
  React.useEffect(() => {
    if (accounts.length > 0) {
      const active = accounts.find((a) => a.is_enabled && a.status === 'active') || accounts[0];
      const targetId = selectedAccountId || active.id;
      if (!selectedAccountId && targetId) {
        selectAccount(targetId);
      } else if (targetId) {
        loadFolderFiles(targetId, currentFolderId);
      }
    }
  }, [accounts, selectedAccountId]);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleDownload = async (file: DriveFile) => {
    if (!selectedAccountId) return;
    setDownloadingId(file.id);
    try {
      const res: any = await driveApi.downloadFile(selectedAccountId, file.id, file.name, file.mime_type);
      if (res?.success) showToast(`${file.name} → ${res.filePath || t('download', language)} ✓`);
      else showToast('Download failed', 'error');
    } catch (e: any) { showToast(e.message || 'Error', 'error'); } finally { setDownloadingId(null); }
  };
  const handleOpenFile = (file: DriveFile) => {
    setPreviewFile(file);
  };
  const handleDelete = async () => {
    if (!selectedAccountId || !deleteCandidate) return;
    try {
      const ok = await driveApi.deleteFile(selectedAccountId, deleteCandidate.id);
      if (ok) { showToast(`${deleteCandidate.name} ${t('delete', language)} ✓`); await loadFolderFiles(selectedAccountId, currentFolderId); }
      else showToast('Delete failed', 'error');
    } catch (e: any) { showToast(e.message || 'Error', 'error'); } finally { setDeleteCandidate(null); }
  };
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId || !newFolderName.trim()) return;
    try {
      const res: any = await driveApi.createFolder(selectedAccountId, currentFolderId, newFolderName.trim());
      if (res && (res.id || res.success !== false)) {
        showToast(`"${newFolderName}" ✓`);
        setNewFolderName(''); setShowCreateFolderModal(false);
        await loadFolderFiles(selectedAccountId, currentFolderId);
      } else showToast('Create failed', 'error');
    } catch (e: any) { showToast(e.message || 'Error', 'error'); }
  };

  // Read file into base64 data URL for later upload
  const readFileAsDataUrl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setSelectedFileObj({ name: file.name, dataUrl: reader.result as string });
    reader.readAsDataURL(file);
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFileAsDataUrl(file);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) readFileAsDataUrl(file);
  };

  // Fetch only folders for the upload destination picker
  const loadUploadFolderItems = async (accId: string, folderId: string) => {
    setLoadingUploadFolders(true);
    try {
      const items = await driveApi.listAccountFiles(accId, folderId);
      setUploadFolderFiles(items.filter((i: DriveFile) => i.mime_type === 'application/vnd.google-apps.folder'));
    } catch {} finally { setLoadingUploadFolders(false); }
  };

  // If 'random' is selected, pick a random active account and upload to root.
  // Otherwise move to step 2 for folder selection.
  const handleStartUploadFlow = async () => {
    if (!selectedFileObj) return;
    if (uploadTargetAccount === 'random') {
      const activeAccounts = accounts.filter((a) => a.is_enabled && a.status === 'active');
      const chosen = activeAccounts.length > 0 ? activeAccounts[Math.floor(Math.random() * activeAccounts.length)] : accounts[0];
      if (!chosen) { showToast('No account', 'error'); return; }
      executeUpload(chosen.id, 'root');
    } else {
      setUploadFolderBreadcrumbs([{ id: 'root', name: 'Root' }]);
      setUploadStep(2);
      await loadUploadFolderItems(uploadTargetAccount, 'root');
    }
  };

  // Strip data URL header, extract MIME, push base64 to backend
  const executeUpload = async (targetAccountId: string, targetFolderId: string) => {
    if (!selectedFileObj) return;
    try {
      const base64Data = selectedFileObj.dataUrl.includes(',') ? selectedFileObj.dataUrl.split(',')[1] : selectedFileObj.dataUrl;
      const mime = selectedFileObj.dataUrl.match(/data:(.*?);/)?.[1] || 'application/octet-stream';
      const res: any = await driveApi.uploadFileBuffer(targetAccountId, targetFolderId, selectedFileObj.name, base64Data, mime);
      if (res && (res.id || res.success !== false)) {
        showToast(`"${selectedFileObj.name}" ✓`);
        setShowUploadModal(false); setSelectedFileObj(null); setUploadStep(1);
        if (selectedAccountId === targetAccountId) await loadFolderFiles(selectedAccountId, currentFolderId);
      } else showToast('Upload failed', 'error');
    } catch (e: any) { showToast(e.message || 'Upload error', 'error'); }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-account-menu]')) setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [accountMenuOpen]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 gap-4 bg-transparent">
      {/* Toolbar: account selector, breadcrumbs, view mode toggle, actions */}
      <div className="bg-cardBg backdrop-blur-xl border border-line rounded-[20px] p-3 flex items-center justify-between gap-3 shadow-mirai flex-wrap relative z-20">
        <div className="flex items-center gap-3">
          <div className="relative" data-account-menu>
            <button
              onClick={() => setAccountMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 bg-cream border border-line rounded-full pl-2 pr-3 py-1.5 text-xs text-ink hover:border-amberMirai/30 transition min-w-[220px] max-w-[300px] shadow-sm"
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-amberMirai to-terracotta flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-sm">
                {selectedAccount ? selectedAccount.email[0]?.toUpperCase() : '—'}
              </span>
              <span className="flex-1 text-left truncate font-medium">
                {selectedAccount ? selectedAccount.email : t('select_account_option', language)}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${accountMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {accountMenuOpen && (
              <div className="absolute top-full mt-2 left-0 w-[340px] bg-cardBg backdrop-blur-xl border border-line rounded-[20px] shadow-mirai p-2 z-50 max-h-[320px] overflow-y-auto">
                <button
                  onClick={() => { selectAccount(null); setAccountMenuOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 rounded-2xl text-xs flex items-center gap-2.5 transition ${!selectedAccountId ? 'bg-ink text-paper' : 'hover:bg-cream text-ink'}`}
                >
                  <span className="w-7 h-7 rounded-full bg-paperDeep border border-line flex items-center justify-center text-muted text-[11px]">—</span>
                  <span className="flex-1 truncate">{t('select_account_option', language)}</span>
                  {!selectedAccountId && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
                <div className="my-2 h-[1px] bg-line/30" />
                {accounts.map((a) => {
                  const active = a.id === selectedAccountId;
                  return (
                    <button
                      key={a.id}
                      onClick={() => { selectAccount(a.id); setAccountMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2.5 rounded-2xl text-xs flex items-center gap-2.5 transition ${active ? 'bg-ink text-paper shadow-sm' : 'hover:bg-cream text-ink'}`}
                    >
                      {a.avatar_url ? (
                        <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover border border-line shrink-0" />
                      ) : (
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border ${active ? 'bg-white/15 border-white/20 text-paper' : 'bg-gradient-to-br from-blush to-paperDeep border-line text-moss'}`}>
                          {a.email.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{a.email}</span>
                        {a.label && <span className={`block truncate text-[11px] ${active ? 'text-paper/70' : 'text-muted'}`}>{a.label}</span>}
                      </span>
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                      {!active && a.status !== 'active' && <span className="w-2 h-2 rounded-full bg-terracotta shrink-0" title={a.status} />}
                    </button>
                  );
                })}
                {accounts.length === 0 && (
                  <p className="text-xs text-muted text-center py-4">{t('no_accounts_title', language)}</p>
                )}
              </div>
            )}
          </div>
          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-1 text-xs text-muted bg-cream border border-line rounded-full px-3 py-1.5">
            {folderBreadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                {idx > 0 && <ChevronRight className="w-3 h-3 text-muted/50" />}
                <button onClick={() => navigateBreadcrumb(idx)} className={`${idx === folderBreadcrumbs.length - 1 ? 'text-ink font-medium' : 'text-muted hover:text-ink'}`}>{crumb.name}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-cream border border-line rounded-full p-1">
            <button onClick={() => setViewMode('list')} className={`w-7 h-7 rounded-full flex items-center justify-center transition ${viewMode==='list' ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}><List className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('grid')} className={`w-7 h-7 rounded-full flex items-center justify-center transition ${viewMode==='grid' ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <button onClick={()=> selectedAccountId && loadFolderFiles(selectedAccountId, currentFolderId)} disabled={!selectedAccountId || isLoading} className="w-8 h-8 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-ink disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
          <button onClick={()=>setShowCreateFolderModal(true)} disabled={!selectedAccountId} className="flex items-center gap-1.5 px-3.5 py-2 bg-cardBg border border-line text-ink text-xs font-medium rounded-full hover:bg-cream transition disabled:opacity-50"><FolderPlus className="w-4 h-4 text-amberDeep" /> {t('create_folder', language)}</button>
          <button onClick={()=>{setUploadStep(1); setSelectedFileObj(null); setShowUploadModal(true);}} className="flex items-center gap-1.5 px-4 py-2 bg-ink text-paper text-xs font-medium rounded-full hover:opacity-90 transition shadow-sm"><Upload className="w-4 h-4" /> {t('upload_file', language)}</button>
        </div>
      </div>

      {/* Toast notification bar */}
      {actionMessage && (
        <div className={`px-4 py-3 rounded-2xl text-xs font-medium flex items-center justify-between border ${actionMessage.type==='success' ? 'bg-sage/10 border-sage/20 text-moss' : 'bg-terracotta/10 border-terracotta/20 text-terracotta'}`}>
          <span>{actionMessage.text}</span><button onClick={()=>setActionMessage(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* File listing area - switches between grid/list views */}
      <div className="flex-1 overflow-auto rounded-[20px] border border-transparent bg-cardBg backdrop-blur-xl p-3 shadow-mirai">
        {isLoading && folderFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3"><RefreshCw className="w-8 h-8 text-amberMirai animate-spin" /><p className="text-sm text-muted">{t('loading_folder', language)}</p></div>
        ) : !selectedAccountId ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted text-sm gap-2">
            <div className="w-14 h-14 rounded-2xl bg-cream border border-line flex items-center justify-center"><AutumnFolderIcon size={28} className="text-muted/50" /></div>
            {t('select_account_prompt', language)}
          </div>
        ) : folderFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted text-sm">{t('no_files_found', language)}</div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {folderFiles.map((file) => {
              const isFolder = file.mime_type === 'application/vnd.google-apps.folder';
              return (
                <div
                  key={file.id}
                  onClick={() => isFolder && selectedAccountId ? loadFolderFiles(selectedAccountId, file.id, file.name) : handleOpenFile(file)}
                  onDoubleClick={() => isFolder && selectedAccountId ? loadFolderFiles(selectedAccountId, file.id, file.name) : handleOpenFile(file)}
                  className="p-3 bg-cream/70 hover:bg-cardSolid border border-transparent hover:border-transparent rounded-2xl flex flex-col items-center text-center group cursor-pointer transition"
                >
                  <div className="w-full flex justify-end"><button onClick={(e)=>{e.stopPropagation(); setDeleteCandidate(file);}} className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-terracotta"><Trash2 className="w-3 h-3" /></button></div>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 border bg-cream border-transparent">{getFileIcon(file, 24)}</div>
                  <p className="text-xs font-medium text-ink truncate w-full">{file.name}</p>
                  <p className="text-[10px] text-muted mt-0.5">{isFolder ? t('folder_label', language) : formatBytes(file.size || 0)}</p>
                  <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition">
                    {!isFolder && <>
                      <button onClick={(e)=>{e.stopPropagation(); handleOpenFile(file);}} className="w-7 h-7 rounded-full bg-cardBg border border-line flex items-center justify-center text-moss hover:bg-sage hover:text-paper hover:border-sage"><Eye className="w-3 h-3" /></button>
                      <button onClick={(e)=>{e.stopPropagation(); handleDownload(file);}} disabled={downloadingId===file.id} className="w-7 h-7 rounded-full bg-ink text-paper flex items-center justify-center"><Download className="w-3 h-3" /></button>
                    </>}
                    {file.web_view_link && <button onClick={(e)=>{e.stopPropagation(); driveApi.openExternalUrl(file.web_view_link!);}} className="w-7 h-7 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-ink"><ExternalLink className="w-3 h-3" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view */
          <div className="divide-y divide-transparent">
            {folderFiles.map((file) => {
              const isFolder = file.mime_type === 'application/vnd.google-apps.folder';
              return (
                <div
                  key={file.id}
                  onClick={() => isFolder && selectedAccountId ? loadFolderFiles(selectedAccountId, file.id, file.name) : handleOpenFile(file)}
                  onDoubleClick={() => isFolder && selectedAccountId ? loadFolderFiles(selectedAccountId, file.id, file.name) : handleOpenFile(file)}
                  className="p-3 flex items-center justify-between hover:bg-cream/30 rounded-xl cursor-pointer transition"
                >
                  <div className="flex items-center gap-3 overflow-hidden flex-1">
                    <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border bg-cream border-transparent">{getFileIcon(file, 18)}</span>
                    <div className="truncate">
                      <div className="text-sm font-medium text-ink truncate">{file.name}</div>
                      <div className="text-xs text-muted flex items-center gap-2"><span>{isFolder ? t('folder_label', language) : formatBytes(file.size || 0)}</span><span className="w-1 h-1 rounded-full bg-line" /><span>{file.modified_time?.slice(0,10)}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isFolder && <>
                      <button onClick={(e)=>{e.stopPropagation(); handleOpenFile(file);}} className="px-3 py-1.5 bg-cardBg border border-line text-moss rounded-full text-xs font-medium hover:bg-sage hover:text-paper hover:border-sage flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {t('open_file_direct', language)}</button>
                      <button onClick={(e)=>{e.stopPropagation(); handleDownload(file);}} disabled={downloadingId===file.id} className="px-3 py-1.5 bg-ink text-paper rounded-full text-xs font-medium flex items-center gap-1"><Download className="w-3.5 h-3.5" /> {t('download_file', language)}</button>
                    </>}
                    {file.web_view_link && <button onClick={(e)=>{e.stopPropagation(); driveApi.openExternalUrl(file.web_view_link!);}} className="w-8 h-8 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-ink"><ExternalLink className="w-4 h-4" /></button>}
                    <button onClick={(e)=>{e.stopPropagation(); setDeleteCandidate(file);}} className="w-8 h-8 rounded-full bg-cardBg border border-line flex items-center justify-center text-muted hover:text-terracotta"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteCandidate && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cardBg border border-line rounded-[24px] max-w-md w-full p-6 space-y-4 shadow-mirai">
            <div className="flex items-center gap-3 text-terracotta"><AlertTriangle className="w-6 h-6" /><h3 className="font-serif text-base text-ink">{t('confirm_delete_title', language)}</h3></div>
            <p className="text-sm text-muted">{t('confirm_delete_desc', language)} <strong className="text-ink">"{deleteCandidate.name}"</strong>?</p>
            <div className="flex justify-end gap-2 pt-2"><button onClick={()=>setDeleteCandidate(null)} className="px-4 py-2 bg-cream border border-line text-ink rounded-full text-xs font-medium">{t('cancel', language)}</button><button onClick={handleDelete} className="px-4 py-2 bg-terracotta text-paper rounded-full text-xs font-medium">{t('delete', language)}</button></div>
          </div>
        </div>
      )}

      {/* Create folder modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cardBg border border-line rounded-[24px] max-w-md w-full p-6 space-y-4 shadow-mirai">
            <div className="flex items-center justify-between"><h3 className="font-serif text-base text-ink flex items-center gap-2"><FolderPlus className="w-5 h-5 text-amberDeep" /> {t('create_folder', language)}</h3><button onClick={()=>setShowCreateFolderModal(false)} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted"><X className="w-4 h-4" /></button></div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div><label className="block text-xs font-medium text-ink mb-1.5">{t('folder_name_label', language)}</label><input type="text" required placeholder={t('folder_name_placeholder', language)} value={newFolderName} onChange={(e)=>setNewFolderName(e.target.value)} className="w-full bg-cream border border-line rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amberMirai/40" /></div>
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={()=>setShowCreateFolderModal(false)} className="px-4 py-2 bg-cream border border-line text-ink rounded-full text-xs font-medium">{t('cancel', language)}</button><button type="submit" className="px-4 py-2 bg-amberMirai text-paper rounded-full text-xs font-medium">{t('save', language)}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Upload modal - two-step wizard */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-modalOverlay backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cardBg border border-line rounded-[24px] max-w-2xl w-full p-6 space-y-5 shadow-mirai max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-transparent pb-3"><h3 className="font-serif text-base text-ink flex items-center gap-2"><Upload className="w-5 h-5 text-terracotta" /> {uploadStep===1 ? t('upload_modal_title_step1', language) : t('upload_modal_title_step2', language)}</h3><button onClick={()=>{setShowUploadModal(false); setSelectedFileObj(null); setUploadStep(1);}} className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted"><X className="w-4 h-4" /></button></div>
            {uploadStep===1 ? (
              <div className="space-y-4">
                {/* Drag-and-drop zone */}
                <div onDragOver={(e)=>e.preventDefault()} onDrop={handleDrop} className={`border-2 border-dashed rounded-[20px] p-6 text-center flex flex-col items-center justify-center ${selectedFileObj ? 'border-sage/30 bg-sage/5' : 'border-line bg-cream/60 hover:border-amberMirai/30'}`}>
                  {selectedFileObj ? (
                    <div className="flex flex-col items-center gap-2"><AutumnFileIcon size={40} className="text-moss" /><span className="text-sm font-medium text-ink">{selectedFileObj.name}</span><span className="text-xs text-moss">✓</span></div>
                  ) : (
                    <div className="flex flex-col items-center gap-2"><Upload className="w-10 h-10 text-muted/50" /><p className="text-sm font-medium text-ink">{t('drag_drop_file', language)}</p><p className="text-xs text-muted">{t('or_select_file', language)}</p><label className="mt-2 px-4 py-2 bg-ink text-paper rounded-full text-xs font-medium cursor-pointer"> {t('choose_file_btn', language)} <input type="file" onChange={handleFileSelect} className="hidden" /></label></div>
                  )}
                </div>
                {/* Account picker with quota bars */}
                <div>
                  <label className="block text-xs font-medium text-ink mb-2">{t('select_target_account', language)}</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    <div onClick={()=>setUploadTargetAccount('random')} className={`p-3 rounded-2xl border cursor-pointer flex items-center justify-between ${uploadTargetAccount==='random' ? 'border-amberMirai bg-blush shadow-sm' : 'border-line bg-cream hover:border-amberMirai/20'}`}>
                      <div><div className="text-xs font-medium text-ink">{t('random_account', language)}</div><div className="text-[11px] text-muted">{t('random_account_desc', language)}</div></div>{uploadTargetAccount==='random' && <Check className="w-4 h-4 text-amberDeep" />}
                    </div>
                    {accounts.map((acc: DriveAccount) => {
                      const usedPct = acc.quota_total > 0 ? Math.round((acc.quota_used/acc.quota_total)*100) : 0;
                      const isFull = usedPct >= 99;
                      const isSelected = uploadTargetAccount===acc.id;
                      return (
                        <div key={acc.id} onClick={()=>setUploadTargetAccount(acc.id)} className={`p-3 rounded-2xl border cursor-pointer flex flex-col ${isSelected ? 'border-amberMirai bg-blush' : isFull ? 'border-transparent bg-cream/50 opacity-50' : 'border-line bg-cream hover:border-amberMirai/20'}`}>
                          <div className="flex items-center justify-between"><span className="text-xs font-medium text-ink truncate">{acc.email}</span>{isSelected && <Check className="w-3.5 h-3.5 text-amberDeep" />}</div>
                          <div className="mt-2 flex items-center gap-2"><div className="flex-1 h-1.5 bg-cardBg border border-line rounded-full overflow-hidden"><div className={`h-full ${isFull ? 'bg-terracotta' : 'bg-sage'}`} style={{width:`${usedPct}%`}} /></div><span className="text-[10px] text-muted font-mono">{usedPct}%</span></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={()=>setShowUploadModal(false)} className="px-4 py-2 bg-cream border border-line text-ink rounded-full text-xs font-medium">{t('cancel', language)}</button>
                  <button onClick={handleStartUploadFlow} disabled={!selectedFileObj} className="px-4 py-2 bg-ink text-paper rounded-full text-xs font-medium disabled:opacity-50">{uploadTargetAccount==='random' ? t('upload_now', language) : t('next', language)}</button>
                </div>
              </div>
            ) : (
              /* Step 2: folder picker for upload destination */
              <div className="space-y-4">
                <div className="flex items-center gap-1 text-xs text-muted bg-cream border border-line rounded-full px-3 py-2">
                  {uploadFolderBreadcrumbs.map((crumb, idx)=>(
                    <React.Fragment key={crumb.id}>{idx>0 && <ChevronRight className="w-3 h-3 text-muted/50" />}<button onClick={async()=>{const nextC=uploadFolderBreadcrumbs.slice(0, idx+1); setUploadFolderBreadcrumbs(nextC); await loadUploadFolderItems(uploadTargetAccount, crumb.id);}} className={`${idx===uploadFolderBreadcrumbs.length-1 ? 'text-ink font-medium' : 'text-muted hover:text-ink'}`}>{crumb.name}</button></React.Fragment>
                  ))}
                </div>
                <div className="border border-line rounded-2xl bg-cream/40 p-2 min-h-48 max-h-56 overflow-y-auto">
                  {loadingUploadFolders ? <div className="flex items-center justify-center h-40"><RefreshCw className="w-6 h-6 text-amberMirai animate-spin" /></div> : uploadFolderFiles.length===0 ? <div className="flex flex-col items-center justify-center h-40 text-muted text-xs">No subfolders — will upload here.</div> : (
                    <div className="space-y-1">
                      {uploadFolderFiles.map((folder)=>(
                        <div key={folder.id} onDoubleClick={async()=>{setUploadFolderBreadcrumbs((prev)=>[...prev, {id: folder.id, name: folder.name}]); await loadUploadFolderItems(uploadTargetAccount, folder.id);}} className="flex items-center justify-between p-2 hover:bg-cardBg rounded-xl cursor-pointer border border-transparent hover:border-line text-xs">
                          <div className="flex items-center gap-2"><AutumnFolderIcon size={16} className="text-amberDeep" /><span className="text-ink font-medium">{folder.name}</span></div><span className="text-[10px] text-muted">double-click</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-between pt-2">
                  <button onClick={()=>setUploadStep(1)} className="px-4 py-2 bg-cream border border-line text-ink rounded-full text-xs font-medium">← {t('cancel', language)}</button>
                  <button onClick={()=>{const cur=uploadFolderBreadcrumbs[uploadFolderBreadcrumbs.length-1]?.id || 'root'; executeUpload(uploadTargetAccount, cur);}} className="px-4 py-2 bg-moss text-paper rounded-full text-xs font-medium">Upload here</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {previewFile && selectedAccountId && (
        <FilePreviewModal
          file={previewFile}
          accountId={selectedAccountId}
          language={language}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};
