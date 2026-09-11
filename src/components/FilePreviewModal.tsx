// Full-screen preview modal for Drive files. Handles images, video, audio, PDF, text, and DOCX.
// Video playback goes through a local Tauri stream server or external player (VLC/MPV)
// due to WebKit codec limitations on Linux.
import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  X,
  Download,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  Volume2,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileCode,
  File as FileIcon,
} from 'lucide-react';
import { driveApi } from '../api';
import { t } from '../locales';
import type { DriveFile } from '../types';
import type { Language } from '../types';

interface FilePreviewModalProps {
  file: DriveFile;
  accountId: string;
  language: Language;
  onClose: () => void;
}

type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'docx' | 'unsupported';

// Extension lists for preview type detection
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'flv', 'wmv', 'ts', 'mts', 'm2ts', 'vob', 'divx', 'asf'];
const BROWSER_PLAYABLE_VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', '3gp'];
// Containers that need an external player (no WebKit support)
const EXTERNAL_VIDEO_EXTS = ['mkv', 'avi', 'flv', 'wmv', 'asf', 'mts', 'm2ts', 'ts', 'vob', 'divx'];
function isBrowserPlayableVideo(ext: string): boolean {
  return BROWSER_PLAYABLE_VIDEO_EXTS.includes(ext.toLowerCase());
}
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'wma', 'opus', 'webm', 'mid', 'midi', 'amr', 'ape', 'wv'];
const TEXT_EXTS = [
  'txt', 'md', 'markdown', 'json', 'xml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx',
  'py', 'rb', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'sh', 'bash',
  'zsh', 'fish', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log', 'csv',
  'sql', 'graphql', 'gql', 'dockerfile', 'makefile', 'gitignore', 'editorconfig',
  'svelte', 'vue', 'astro', 'prisma', 'proto', 'tf', 'hcl',
  'sol', 'vy', 'move', 'cairo', 'fe',
  'kt', 'kts', 'scala', 'sc', 'clj', 'cljs', 'edn', 'ex', 'exs', 'erl', 'hrl',
  'hs', 'lhs', 'ml', 'mli', 'fs', 'fsi', 'fsx', 'r', 'R', 'rmd', 'jl',
  'lua', 'pl', 'pm', 'tcl', 'nim', 'zig', 'd', 'v', 'sv', 'vhd', 'vhdl',
  'asm', 's', 'S', 'nasm', 'cmake', 'gradle', 'properties', 'bat', 'cmd', 'ps1',
  'psm1', 'psd1', 'nix', 'dhall', 'jsonc', 'json5', 'jsonl', 'ndjson',
  'rst', 'adoc', 'asciidoc', 'tex', 'latex', 'bib', 'srt', 'vtt', 'ass', 'ssa',
  'diff', 'patch', 'pem', 'pub', 'key', 'crt', 'csr', 'lock',
  'snap', 'map', 'hbs', 'ejs', 'pug', 'jade', 'twig', 'liquid',
  'tf', 'tfvars', 'service', 'timer', 'socket', 'desktop', 'reg',
];

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/x-icon', 'image/tiff', 'image/avif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/3gpp', 'video/x-flv', 'video/x-ms-wmv', 'video/MP2T', 'video/avi'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-ms-wma', 'audio/opus', 'audio/webm', 'audio/midi', 'audio/amr'];

function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

// Determine preview strategy from MIME and extension. Google Docs/Sheets/Slides
// are exported as PDF on the backend side.
function detectPreviewType(file: DriveFile): PreviewType {
  const ext = getFileExtension(file.name);
  const mime = (file.mime_type || '').toLowerCase();

  if (mime === 'application/vnd.google-apps.document' ||
      mime === 'application/vnd.google-apps.spreadsheet' ||
      mime === 'application/vnd.google-apps.presentation') {
    return 'pdf';
  }

  if (IMAGE_MIMES.some(m => mime.startsWith(m)) || IMAGE_EXTS.includes(ext)) return 'image';

  if (VIDEO_MIMES.some(m => mime.startsWith(m)) || VIDEO_EXTS.includes(ext)) return 'video';

  if (AUDIO_MIMES.some(m => mime.startsWith(m)) || AUDIO_EXTS.includes(ext)) return 'audio';

  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'docx';

  if (TEXT_EXTS.includes(ext)) return 'text';

  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/json' || mime === 'application/xml' ||
      mime === 'application/javascript' || mime === 'application/x-sh' ||
      mime === 'application/x-yaml' || mime === 'application/toml' ||
      mime === 'application/x-python-code' || mime === 'application/x-ruby') return 'text';

  if (mime === '' || mime === 'application/octet-stream') {
    return 'unsupported';
  }

  return 'unsupported';
}

// Resolve correct MIME for Blob construction based on extension
function getMimeForBlob(file: DriveFile, previewType: PreviewType): string {
  const ext = getFileExtension(file.name);
  const mime = file.mime_type || '';

  if (previewType === 'image') {
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'avif') return 'image/avif';
    return 'image/jpeg';
  }
  if (previewType === 'video') {
    if (ext === 'webm') return 'video/webm';
    if (ext === 'ogg' || ext === 'ogv') return 'video/ogg';
    if (ext === 'mov') return 'video/quicktime';
    if (ext === 'mkv') return 'video/x-matroska';
    return 'video/mp4';
  }
  if (previewType === 'audio') {
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'aac') return 'audio/aac';
    if (ext === 'm4a') return 'audio/mp4';
    if (ext === 'opus') return 'audio/opus';
    return 'audio/mpeg';
  }
  if (previewType === 'pdf') return 'application/pdf';
  if (previewType === 'text') return 'text/plain';
  if (previewType === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return mime || 'application/octet-stream';
}

// Google Workspace types need export conversion to PDF
function getExportMime(file: DriveFile): string | null {
  const mime = (file.mime_type || '').toLowerCase();
  if (mime === 'application/vnd.google-apps.document') return 'application/pdf';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'application/pdf';
  if (mime === 'application/vnd.google-apps.presentation') return 'application/pdf';
  return null;
}

function getPreviewIcon(previewType: PreviewType) {
  switch (previewType) {
    case 'image': return <ImageIcon className="w-5 h-5" />;
    case 'video': return <Film className="w-5 h-5" />;
    case 'audio': return <Music className="w-5 h-5" />;
    case 'pdf': return <FileText className="w-5 h-5" />;
    case 'text': return <FileCode className="w-5 h-5" />;
    case 'docx': return <FileText className="w-5 h-5" />;
    default: return <FileIcon className="w-5 h-5" />;
  }
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, accountId, language, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Local stream server creds (port + ephemeral token) from Tauri backend
  const [streamCreds, setStreamCreds] = useState<{ port: number; token: string } | null>(null);
  const [imageError, setImageError] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<{ port: number; token: string }>('get_stream_creds').then(setStreamCreds).catch(() => {
      invoke<number>('get_stream_port').then(port => setStreamCreds({ port, token: '' })).catch(console.error);
    });
  }, []);

  const previewType = detectPreviewType(file);

  // Main content loader. Video/audio use streaming URLs, others download raw bytes.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setObjectUrl(null);
      setTextContent(null);
      setDocxHtml(null);
      setImageError(false);

      // Video is streamed, no need to download
      if (previewType === 'video') {
        setLoading(false);
        return;
      }
      // Audio streams from local server — Authorization header preferred (no query leakage)
      if (previewType === 'audio') {
        if (!streamCreds) {
          return;
        }
        try {
          const ext = getFileExtension(file.name);
          const url = `http://127.0.0.1:${streamCreds.port}/stream/${accountId}/${file.id}?ext=${encodeURIComponent(ext)}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${streamCreds.token}` }, referrerPolicy: 'no-referrer' });
          if (!res.ok) throw new Error(`Stream ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          if (!cancelled) { setObjectUrl(blobUrl); setLoading(false); }
          return;
        } catch {
          // Fallback to query param (documented exception for media element)
          const ext = getFileExtension(file.name);
          setObjectUrl(`http://127.0.0.1:${streamCreds.port}/stream/${accountId}/${file.id}?ext=${encodeURIComponent(ext)}&token=${encodeURIComponent(streamCreds.token)}`);
          setLoading(false);
          return;
        }
      }

      // Images via Authorization header → blob (no token in URL/history)
      if (previewType === 'image' && streamCreds) {
        try {
          const ext = getFileExtension(file.name);
          const url = `http://127.0.0.1:${streamCreds.port}/stream/${accountId}/${file.id}?ext=${encodeURIComponent(ext)}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${streamCreds.token}` }, referrerPolicy: 'no-referrer' });
          if (!res.ok) throw new Error(`Stream ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          if (!cancelled) { setObjectUrl(blobUrl); setLoading(false); }
          return;
        } catch {
          // Fallback to query param if fetch fails (e.g., CORS edge)
          const ext = getFileExtension(file.name);
          setObjectUrl(`http://127.0.0.1:${streamCreds.port}/stream/${accountId}/${file.id}?ext=${encodeURIComponent(ext)}&token=${encodeURIComponent(streamCreds.token)}`);
          setLoading(false);
          return;
        }
      }

      // Everything else: download raw bytes and handle in-memory
      try {
        const exportMime = getExportMime(file);
        const data: number[] = await driveApi.downloadFileRaw(accountId, file.id, exportMime || undefined);
        if (cancelled) return;

        const uint8 = new Uint8Array(data);

        if (previewType === 'text') {
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(uint8);
          setTextContent(text);
        } else if (previewType === 'docx') {
          try {
            const mammoth = await import('mammoth');
            const DOMPurify = (await import('dompurify')).default;
            const result = await mammoth.convertToHtml({ arrayBuffer: uint8.buffer });
            // Strict allowlist: no script, no event handlers, no dangerous URLs, no SVG/MathML
            const clean = DOMPurify.sanitize(result.value, {
              USE_PROFILES: { html: true },
              ALLOWED_TAGS: [
                'p','br','b','i','em','strong','a','ul','ol','li','h1','h2','h3','h4','h5','h6',
                'blockquote','code','pre','table','thead','tbody','tr','th','td','hr','span','div'
              ],
              ALLOWED_ATTR: ['href','title','colspan','rowspan'],
              FORBID_TAGS: ['script','style','iframe','object','embed','form','img','svg','math','link','meta','base'],
              FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onfocus','onblur','style'],
              ALLOW_DATA_ATTR: false,
              ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            });
            setDocxHtml(clean);
          } catch (e: any) {
            setError(`DOCX parse error: ${e.message}`);
          }
        } else {
          const blobMime = getMimeForBlob(file, previewType);
          const blob = new Blob([uint8], { type: blobMime });
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      // Only revoke blob URLs, not stream URLs
      if (objectUrl && !objectUrl.startsWith('http://127.0.0.1')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.id, accountId, streamCreds]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const handleDownload = async () => {
    try {
      const res: any = await driveApi.downloadFile(accountId, file.id, file.name, file.mime_type);
      if (res?.filePath) {
        setDownloadPath(res.filePath);
        setTimeout(() => setDownloadPath(null), 6000);
      }
    } catch {}
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  const handleVideoError = () => {
    setError('Video codec not supported in this environment. Use the download or open-in-browser buttons.');
  };

  const [openingExternal, setOpeningExternal] = useState(false);
  const [tryBrowserVideo, setTryBrowserVideo] = useState(false);
  useEffect(() => { setTryBrowserVideo(false); }, [file.id]);

  // Invoke Tauri command to open file with system default app
  const handleOpenExternalPlayer = async () => {
    setOpeningExternal(true);
    try {
      await invoke('open_file_externally', { account_id: accountId, file_id: file.id, file_name: file.name });
    } catch (e: any) {
      setError(e?.toString() || 'Failed to open externally');
    } finally {
      setOpeningExternal(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <RefreshCw className="w-10 h-10 text-amberMirai animate-spin" />
          <p className="text-sm text-muted">{t('loading_preview', language)}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <div className="w-16 h-16 rounded-2xl bg-terracotta/10 border border-terracotta/20 flex items-center justify-center">
            <FileIcon className="w-8 h-8 text-terracotta" />
          </div>
          <p className="text-sm text-terracotta text-center max-w-md">{error}</p>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className="px-4 py-2 bg-ink text-paper rounded-full text-xs font-medium flex items-center gap-2">
              <Download className="w-3.5 h-3.5" /> {t('download_file', language)}
            </button>
            {file.web_view_link && (
              <button onClick={() => driveApi.openExternalUrl(file.web_view_link!)} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium flex items-center gap-2">
                <ExternalLink className="w-3.5 h-3.5" /> {t('open_in_browser', language)}
              </button>
            )}
          </div>
        </div>
      );
    }

    switch (previewType) {
      case 'image':
        return (
          <div className="flex items-center justify-center h-full p-4 overflow-auto">
            {!imageError ? (
              <img
                src={objectUrl!}
                alt={file.name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                style={{ maxHeight: isFullscreen ? '95vh' : '70vh' }}
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-terracotta/10 border border-terracotta/20 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-terracotta" />
                </div>
                <p className="text-sm text-muted">Image could not be loaded (403 or format error)</p>
                <div className="flex items-center gap-2">
                  <button onClick={handleDownload} className="px-4 py-2 bg-ink text-paper rounded-full text-xs font-medium flex items-center gap-2">
                    <Download className="w-3.5 h-3.5" /> {t('download_file', language)}
                  </button>
                  {file.web_view_link && (
                    <button onClick={() => driveApi.openExternalUrl(file.web_view_link!)} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium flex items-center gap-2">
                      <ExternalLink className="w-3.5 h-3.5" /> {t('open_in_browser', language)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'video': {
        const ext = getFileExtension(file.name);
        const isExternalOnly = EXTERNAL_VIDEO_EXTS.includes(ext);
        const isPlayable = isBrowserPlayableVideo(ext);

        // Experimental: try inline playback via stream server (auth token required)
        if (tryBrowserVideo && streamCreds) {
          const videoSrc = `http://127.0.0.1:${streamCreds.port}/stream/${accountId}/${file.id}?ext=${encodeURIComponent(ext)}&token=${encodeURIComponent(streamCreds.token)}`;
          return (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <video
                src={videoSrc}
                controls
                playsInline
                preload="metadata"
                className="max-w-full max-h-full rounded-lg shadow-lg"
                style={{ maxHeight: isFullscreen ? '92vh' : '62vh' }}
                onError={handleVideoError}
              >
                {t('unsupported_format', language)}
              </video>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button onClick={() => setTryBrowserVideo(false)} className="px-3 py-1.5 bg-cream border border-line text-muted rounded-full text-xs">← Önizlemeye dön</button>
                <button onClick={handleOpenExternalPlayer} disabled={openingExternal} className="px-3 py-1.5 bg-cardBg border border-line text-ink rounded-full text-xs flex items-center gap-1.5"><ExternalLink className="w-3 h-3" /> Harici oynatıcıda aç</button>
                <button onClick={handleDownload} className="px-3 py-1.5 bg-ink text-paper rounded-full text-xs flex items-center gap-1"><Download className="w-3 h-3" /> İndir</button>
              </div>
              <p className="text-[11px] text-muted/60 text-center">Çökerse sistemde GStreamer pluginleri eksiktir: <code>sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav</code></p>
            </div>
          );
        }

        // Default: show info card with external player as primary action
        return (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div className="w-20 h-20 rounded-3xl bg-amberMirai/15 border border-amberMirai/20 flex items-center justify-center">
              <Film className="w-10 h-10 text-amberDeep" />
            </div>
            <p className="text-sm font-medium text-ink text-center">{file.name}</p>
            <p className="text-xs text-muted text-center max-w-md">
              {isExternalOnly ? (
                <> .{ext} formatı tarayıcıda oynatılamaz. Harici oynatıcı (VLC / MPV) önerilir.</>
              ) : (
                <> Video önizleme GStreamer'a ihtiyaç duyar. Stabil mod harici oynatıcıdır.</>
              )}
              <br />
              <span className="opacity-60">{isExternalOnly ? 'MKV / AVI / FLV gibi containerlar WebKit\'te desteklenmez.' : 'MP4 bile eksik pluginlerde WebKitWebProcess\'i çökertebilir.'}</span>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={handleOpenExternalPlayer}
                disabled={openingExternal}
                className="px-5 py-2.5 bg-ink text-paper rounded-full text-xs font-medium flex items-center gap-2 hover:opacity-90 transition disabled:opacity-50"
              >
                {openingExternal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                {openingExternal ? 'Açılıyor...' : 'Harici oynatıcıda aç'}
              </button>
              {isPlayable && streamCreds && (
                <button onClick={() => setTryBrowserVideo(true)} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium hover:border-amberMirai/30">
                  Tarayıcıda dene (deneysel)
                </button>
              )}
              {!isPlayable && streamCreds && (
                <button onClick={() => setTryBrowserVideo(true)} className="px-4 py-2 bg-cardBg border border-line text-muted rounded-full text-xs">Yine de tarayıcıda dene</button>
              )}
              {!streamCreds && (
                <span className="px-4 py-2 bg-cream border border-line rounded-full text-xs text-muted flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> stream hazırlanıyor…</span>
              )}
              <button onClick={handleDownload} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium flex items-center gap-2">
                <Download className="w-3.5 h-3.5" /> {t('download_file', language)}
              </button>
              {file.web_view_link && (
                <button onClick={() => driveApi.openExternalUrl(file.web_view_link!)} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5" /> {t('open_in_browser', language)}
                </button>
              )}
            </div>
          </div>
        );
      }

      case 'audio':
        return (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-amberMirai/20 to-sage/20 border border-line flex items-center justify-center">
              <Volume2 className="w-16 h-16 text-amberDeep" />
            </div>
            <p className="text-lg font-serif text-ink text-center">{file.name}</p>
            <audio src={objectUrl!} controls autoPlay className="w-full max-w-lg">
              {t('unsupported_format', language)}
            </audio>
          </div>
        );

      case 'pdf':
        return (
          <div className="flex-1 h-full p-2">
            <iframe
              src={objectUrl!}
              title={file.name}
              className="w-full h-full rounded-lg border border-line"
              style={{ minHeight: isFullscreen ? '90vh' : '65vh' }}
            />
          </div>
        );

      case 'text':
        return (
          <div className="flex-1 h-full p-4 overflow-auto">
            <pre className="bg-cream/60 border border-line rounded-2xl p-4 text-xs text-ink font-mono whitespace-pre-wrap break-words overflow-auto"
              style={{ maxHeight: isFullscreen ? '90vh' : '65vh' }}
            >{textContent}</pre>
          </div>
        );

      case 'docx':
        return (
          <div className="flex-1 h-full p-4 overflow-auto">
            <div
              className="bg-cardBg border border-line rounded-2xl p-6 prose prose-sm max-w-none overflow-auto"
              style={{ maxHeight: isFullscreen ? '90vh' : '65vh' }}
              dangerouslySetInnerHTML={{ __html: docxHtml || '' }}
            />
          </div>
        );

      case 'unsupported':
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div className="w-20 h-20 rounded-3xl bg-cream border border-line flex items-center justify-center">
              <FileIcon className="w-10 h-10 text-muted/50" />
            </div>
            <p className="text-sm text-ink font-medium text-center">{file.name}</p>
            <p className="text-xs text-muted text-center">{t('unsupported_format_desc', language)}</p>
            <div className="flex items-center gap-2">
              <button onClick={handleDownload} className="px-4 py-2 bg-ink text-paper rounded-full text-xs font-medium flex items-center gap-2">
                <Download className="w-3.5 h-3.5" /> {t('download_file', language)}
              </button>
              {file.web_view_link && (
                <button onClick={() => driveApi.openExternalUrl(file.web_view_link!)} className="px-4 py-2 bg-cardBg border border-line text-ink rounded-full text-xs font-medium flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5" /> {t('open_in_browser', language)}
                </button>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-modalOverlay backdrop-blur-md z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={`bg-cardBg border border-line rounded-[24px] shadow-mirai flex flex-col overflow-hidden transition-all duration-300 ${
          isFullscreen
            ? 'w-[98vw] h-[98vh]'
            : 'w-[90vw] max-w-5xl h-[85vh]'
        }`}
      >
        {/* Modal header: file info + action buttons */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-transparent shrink-0">
          <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sage/10 border border-sage/15 flex items-center justify-center text-moss shrink-0">
              {getPreviewIcon(previewType)}
            </div>
            <div className="truncate">
              <p className="text-sm font-medium text-ink truncate">{file.name}</p>
              <p className="text-[11px] text-muted">{file.mime_type} {file.size ? `  ${formatBytes(file.size)}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleDownload}
              className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted hover:text-ink transition"
              title={t('download_file', language)}
            >
              <Download className="w-4 h-4" />
            </button>
            {file.web_view_link && (
              <button
                onClick={() => driveApi.openExternalUrl(file.web_view_link!)}
                className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted hover:text-ink transition"
                title={t('open_in_browser', language)}
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-full bg-cream border border-line flex items-center justify-center text-muted hover:text-ink transition"
              title={isFullscreen ? 'Minimize' : 'Maximize'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-ink text-paper flex items-center justify-center hover:opacity-90 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {downloadPath && (
          <div className="mx-5 mt-3 px-3 py-2 bg-sage/10 border border-sage/20 rounded-xl text-xs text-moss flex items-center justify-between">
            <span className="truncate">✓ İndirildi: {downloadPath}</span>
            <button onClick={() => setDownloadPath(null)} className="ml-2 shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-cream/30">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
