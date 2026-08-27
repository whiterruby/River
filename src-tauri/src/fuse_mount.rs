//! RiverFS — FUSE filesystem that exposes the total Google Drive pool as a
//! mounted disk. All active accounts are merged into a single directory tree.
//!
//! Layout:
//!   <mountpoint>/
//!   ├── <account-email>/          ← one folder per enabled account
//!   │   ├── My Document.docx     ← root-level Drive files
//!   │   ├── Photos/              ← Drive folders become subdirs
//!   │   │   └── img.jpg
//!   │   └── …
//!   └── <other-account>/
//!
//! Features:
//!   - readdir, read, write (upload), mkdir, unlink, statfs
//!   - statfs reports aggregated pool quota
//!   - Lazy directory listing with caching (TTL 60 s)
//!   - Streaming read via google_api::download_file
//!   - Write via upload_file (whole-file, flushed on release)

use crate::db::Database;
use crate::google_api;

use fuser::{
    FileAttr, FileType, Filesystem, MountOption, ReplyAttr, ReplyCreate, ReplyData,
    ReplyDirectory, ReplyEntry, ReplyOpen, ReplyStatfs, ReplyWrite, ReplyXattr, Request,
};
use libc::{EACCES, EEXIST, EINVAL, EIO, ENODATA, ENOENT, ENOTDIR, ENOTEMPTY};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

const TTL: Duration = Duration::from_secs(300);
const BLOCK_SIZE: u32 = 4096;
/// inode 1 = root, 2..N = synthesised
const ROOT_INO: u64 = 1;

/// Represents a node in the virtual filesystem tree.
#[derive(Debug, Clone)]
struct FsNode {
    ino: u64,
    name: String,
    /// Drive file ID (None for root / synthetic account dirs)
    drive_id: Option<String>,
    /// Account UUID that owns this node
    account_id: Option<String>,
    account_email: Option<String>,
    /// mime for type dispatch
    mime: String,
    is_dir: bool,
    size: u64,
    parent_ino: u64,
    /// Children already fetched?
    children_loaded: bool,
    children_loaded_at: Option<Instant>,
}

impl FsNode {
    fn attr(&self) -> FileAttr {
        let kind = if self.is_dir {
            FileType::Directory
        } else {
            FileType::RegularFile
        };
        let now = SystemTime::now();
        FileAttr {
            ino: self.ino,
            size: self.size,
            blocks: (self.size + 511) / 512,
            atime: now,
            mtime: now,
            ctime: now,
            crtime: now,
            kind,
            perm: if self.is_dir { 0o755 } else { 0o644 },
            nlink: if self.is_dir { 2 } else { 1 },
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
            rdev: 0,
            blksize: BLOCK_SIZE,
            flags: 0,
        }
    }
}

/// In-memory write buffer for whole-file uploads.
struct WriteHandle {
    account_id: String,
    parent_drive_id: String,
    file_name: String,
    mime: String,
    buf: Vec<u8>,
}

pub struct RiverFS {
    db: Arc<Database>,
    /// inode counter
    next_ino: AtomicU64,
    /// inode -> node
    nodes: Mutex<HashMap<u64, FsNode>>,
    /// (parent_ino, child_name) -> child_ino for quick lookup
    name_index: Mutex<HashMap<(u64, String), u64>>,
    /// open write handles: fh -> WriteHandle
    write_handles: Mutex<HashMap<u64, WriteHandle>>,
    next_fh: AtomicU64,
    /// Runtime handle for blocking on async operations
    rt: tokio::runtime::Handle,
    /// Pool-level quota cache
    pool_total: AtomicU64,
    pool_used: AtomicU64,
    /// Shutdown signal
    shutdown: Arc<AtomicBool>,
}

impl RiverFS {
    pub fn new(db: Arc<Database>, rt: tokio::runtime::Handle, shutdown: Arc<AtomicBool>) -> Self {
        let mut nodes = HashMap::new();
        let root = FsNode {
            ino: ROOT_INO,
            name: String::new(),
            drive_id: None,
            account_id: None,
            account_email: None,
            mime: "inode/directory".into(),
            is_dir: true,
            size: 0,
            parent_ino: ROOT_INO,
            children_loaded: false,
            children_loaded_at: None,
        };
        nodes.insert(ROOT_INO, root);

        RiverFS {
            db,
            next_ino: AtomicU64::new(2),
            nodes: Mutex::new(nodes),
            name_index: Mutex::new(HashMap::new()),
            write_handles: Mutex::new(HashMap::new()),
            next_fh: AtomicU64::new(1),
            rt,
            pool_total: AtomicU64::new(0),
            pool_used: AtomicU64::new(0),
            shutdown,
        }
    }

    fn alloc_ino(&self) -> u64 {
        self.next_ino.fetch_add(1, Ordering::SeqCst)
    }

    fn is_shutting_down(&self) -> bool {
        self.shutdown.load(Ordering::SeqCst)
    }

    fn alloc_fh(&self) -> u64 {
        self.next_fh.fetch_add(1, Ordering::SeqCst)
    }

    /// Get a fresh access token for an account (blocking on async).
    fn get_token(&self, account_id: &str) -> Result<(String, Option<String>, Option<String>), String> {
        let (refresh, client_id, client_secret) = self.db.get_account_refresh_token(account_id)?;
        let access = self.rt.block_on(google_api::get_access_token_cached(
            account_id,
            &refresh,
            client_id.as_deref(),
            client_secret.as_deref(),
        ))?;
        Ok((access, client_id, client_secret))
    }

    /// Ensure root's children (account email dirs) are populated.
    fn ensure_root_children(&self) {
        let mut nodes = self.nodes.lock().unwrap();
        let root = nodes.get(&ROOT_INO).unwrap().clone();
        if root.children_loaded && root.children_loaded_at.map_or(false, |t| t.elapsed() < TTL) {
            return;
        }
        // Get all active accounts
        let accounts = match self.db.get_all_accounts() {
            Ok(a) => a,
            Err(_) => return,
        };

        // Update pool quota
        let mut total: u64 = 0;
        let mut used: u64 = 0;
        let mut name_idx = self.name_index.lock().unwrap();

        for acc in &accounts {
            if !acc.is_enabled || acc.status != "active" {
                continue;
            }
            total += acc.quota_total.max(0) as u64;
            used += acc.quota_used.max(0) as u64;

            // Check if email dir already exists
            let key = (ROOT_INO, acc.email.clone());
            if name_idx.contains_key(&key) {
                continue;
            }
            let ino = self.alloc_ino();
            let node = FsNode {
                ino,
                name: acc.email.clone(),
                drive_id: None, // root of this account = Drive "root"
                account_id: Some(acc.id.clone()),
                account_email: Some(acc.email.clone()),
                mime: "inode/directory".into(),
                is_dir: true,
                size: 0,
                parent_ino: ROOT_INO,
                children_loaded: false,
                children_loaded_at: None,
            };
            nodes.insert(ino, node);
            name_idx.insert(key, ino);
        }

        self.pool_total.store(total, Ordering::SeqCst);
        self.pool_used.store(used, Ordering::SeqCst);

        // Mark root loaded
        if let Some(r) = nodes.get_mut(&ROOT_INO) {
            r.children_loaded = true;
            r.children_loaded_at = Some(Instant::now());
        }
    }

    /// Ensure children of a directory (Drive folder) are listed.
    fn ensure_dir_children(&self, parent_ino: u64) {
        // 1. If already cached in memory, return immediately without re-checking or blocking
        let (account_id, drive_parent_id, needs_load) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(parent) = nodes.get(&parent_ino) else { return };
            if !parent.is_dir {
                return;
            }
            if parent.children_loaded {
                return;
            }
            let aid = match &parent.account_id {
                Some(a) => a.clone(),
                None => return,
            };
            // drive_id None => account root => "root"
            let did = parent.drive_id.clone().unwrap_or("root".into());
            (aid, did, true)
        };

        if !needs_load || self.is_shutting_down() {
            return;
        }

        // Get token + list from Drive
        let (access, _cid, _csec) = match self.get_token(&account_id) {
            Ok(t) => t,
            Err(e) => {
                log::warn!("[RiverFS] token error for {}: {}", account_id, crate::crypto::redact(&e));
                return;
            }
        };

        let account_email = {
            let nodes = self.nodes.lock().unwrap();
            nodes.get(&parent_ino)
                .and_then(|n| n.account_email.clone())
                .unwrap_or_default()
        };

        let files = match self.rt.block_on(google_api::list_files(
            &access,
            Some(&drive_parent_id),
            1000,
            &account_id,
            &account_email,
        )) {
            Ok(f) => f,
            Err(e) => {
                log::warn!("[RiverFS] list error: {}", crate::crypto::redact(&e));
                return;
            }
        };

        let mut nodes = self.nodes.lock().unwrap();
        let mut name_idx = self.name_index.lock().unwrap();

        for file in &files {
            let key = (parent_ino, file.name.clone());
            if name_idx.contains_key(&key) {
                // Update size if changed
                if let Some(ino) = name_idx.get(&key) {
                    if let Some(n) = nodes.get_mut(ino) {
                        n.size = file.size.unwrap_or(0).max(0) as u64;
                    }
                }
                continue;
            }
            let ino = self.alloc_ino();
            let node = FsNode {
                ino,
                name: file.name.clone(),
                drive_id: Some(file.id.clone()),
                account_id: Some(account_id.clone()),
                account_email: Some(account_email.clone()),
                mime: file.mime_type.clone(),
                is_dir: file.is_folder,
                size: file.size.unwrap_or(0).max(0) as u64,
                parent_ino,
                children_loaded: false,
                children_loaded_at: None,
            };
            nodes.insert(ino, node);
            name_idx.insert(key, ino);
        }

        if let Some(parent) = nodes.get_mut(&parent_ino) {
            parent.children_loaded = true;
            parent.children_loaded_at = Some(Instant::now());
        }
    }

    /// Collect children inodes of parent.
    fn get_children(&self, parent_ino: u64) -> Vec<(u64, String, bool)> {
        let nodes = self.nodes.lock().unwrap();
        let mut children = Vec::new();
        for node in nodes.values() {
            if node.parent_ino == parent_ino && node.ino != parent_ino {
                children.push((node.ino, node.name.clone(), node.is_dir));
            }
        }
        children.sort_by(|a, b| a.1.cmp(&b.1));
        children
    }
}

impl Filesystem for RiverFS {
    fn lookup(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEntry) {
        let name_str = name.to_string_lossy().to_string();
        if parent == ROOT_INO {
            self.ensure_root_children();
        }
        let name_idx = self.name_index.lock().unwrap();
        if let Some(&ino) = name_idx.get(&(parent, name_str.clone())) {
            let nodes = self.nodes.lock().unwrap();
            if let Some(node) = nodes.get(&ino) {
                reply.entry(&TTL, &node.attr(), 0);
                return;
            }
        }
        reply.error(ENOENT);
    }

    fn getattr(&mut self, _req: &Request, ino: u64, _fh: Option<u64>, reply: ReplyAttr) {
        let nodes = self.nodes.lock().unwrap();
        if let Some(node) = nodes.get(&ino) {
            reply.attr(&TTL, &node.attr());
        } else {
            reply.error(ENOENT);
        }
    }

    fn readdir(
        &mut self,
        _req: &Request,
        ino: u64,
        _fh: u64,
        offset: i64,
        mut reply: ReplyDirectory,
    ) {
        if ino == ROOT_INO {
            self.ensure_root_children();
        } else {
            self.ensure_dir_children(ino);
        }

        let mut entries: Vec<(u64, String, FileType)> = Vec::new();
        entries.push((ino, ".".into(), FileType::Directory));
        let parent_ino = {
            let nodes = self.nodes.lock().unwrap();
            nodes.get(&ino).map(|n| n.parent_ino).unwrap_or(ROOT_INO)
        };
        entries.push((parent_ino, "..".into(), FileType::Directory));

        for (child_ino, name, is_dir) in self.get_children(ino) {
            let ftype = if is_dir {
                FileType::Directory
            } else {
                FileType::RegularFile
            };
            entries.push((child_ino, name, ftype));
        }

        for (i, (entry_ino, name, ftype)) in entries.iter().enumerate().skip(offset as usize) {
            if reply.add(*entry_ino, (i + 1) as i64, *ftype, &name) {
                break;
            }
        }
        reply.ok();
    }

    fn open(&mut self, _req: &Request, ino: u64, _flags: i32, reply: ReplyOpen) {
        let nodes = self.nodes.lock().unwrap();
        if nodes.contains_key(&ino) {
            reply.opened(0, 0);
        } else {
            reply.error(ENOENT);
        }
    }

    fn read(
        &mut self,
        _req: &Request,
        ino: u64,
        _fh: u64,
        offset: i64,
        size: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyData,
    ) {
        let (account_id, drive_id, mime) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(node) = nodes.get(&ino) else {
                reply.error(ENOENT);
                return;
            };
            if node.is_dir {
                reply.error(EINVAL);
                return;
            }
            let aid = node.account_id.clone().unwrap_or_default();
            let did = node.drive_id.clone().unwrap_or_default();
            let mime = node.mime.clone();
            (aid, did, mime)
        };

        // Get token and download
        let access = match self.get_token(&account_id) {
            Ok((t, _, _)) => t,
            Err(_) => {
                reply.error(EIO);
                return;
            }
        };

        let data = match self.rt.block_on(google_api::download_file(
            &access,
            &drive_id,
            Some(&mime),
        )) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[RiverFS] download error: {}", crate::crypto::redact(&e));
                reply.error(EIO);
                return;
            }
        };

        // Update size to actual
        {
            let mut nodes = self.nodes.lock().unwrap();
            if let Some(n) = nodes.get_mut(&ino) {
                n.size = data.len() as u64;
            }
        }

        let offset = offset as usize;
        let end = (offset + size as usize).min(data.len());
        if offset >= data.len() {
            reply.data(&[]);
        } else {
            reply.data(&data[offset..end]);
        }
    }

    fn create(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        _flags: i32,
        reply: ReplyCreate,
    ) {
        let name_str = name.to_string_lossy().to_string();

        // Get parent info
        let (account_id, account_email, parent_drive_id) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(pnode) = nodes.get(&parent) else {
                reply.error(ENOENT);
                return;
            };
            if !pnode.is_dir {
                reply.error(ENOTDIR);
                return;
            }
            let aid = pnode.account_id.clone().unwrap_or_default();
            let aemail = pnode.account_email.clone().unwrap_or_default();
            let pdid = pnode.drive_id.clone().unwrap_or("root".into());
            (aid, aemail, pdid)
        };

        if account_id.is_empty() {
            reply.error(EACCES); // can't create at pool root
            return;
        }

        // Check name doesn't exist
        {
            let idx = self.name_index.lock().unwrap();
            if idx.contains_key(&(parent, name_str.clone())) {
                reply.error(EEXIST);
                return;
            }
        }

        // Create inode + open a write handle
        let ino = self.alloc_ino();
        let fh = self.alloc_fh();
        let mime_guess = mime_guess::from_path(&name_str)
            .first_raw()
            .unwrap_or("application/octet-stream")
            .to_string();

        let node = FsNode {
            ino,
            name: name_str.clone(),
            drive_id: None, // will be set on flush/release after upload
            account_id: Some(account_id.clone()),
            account_email: Some(account_email),
            mime: mime_guess.clone(),
            is_dir: false,
            size: 0,
            parent_ino: parent,
            children_loaded: false,
            children_loaded_at: None,
        };
        let attr = node.attr();

        {
            let mut nodes = self.nodes.lock().unwrap();
            nodes.insert(ino, node);
            let mut idx = self.name_index.lock().unwrap();
            idx.insert((parent, name_str.clone()), ino);
        }

        let wh = WriteHandle {
            account_id,
            parent_drive_id,
            file_name: name_str,
            mime: mime_guess,
            buf: Vec::new(),
        };
        self.write_handles.lock().unwrap().insert(fh, wh);

        reply.created(&TTL, &attr, 0, fh, 0);
    }

    fn write(
        &mut self,
        _req: &Request,
        _ino: u64,
        fh: u64,
        offset: i64,
        data: &[u8],
        _write_flags: u32,
        _flags: i32,
        _lock_owner: Option<u64>,
        reply: ReplyWrite,
    ) {
        let mut handles = self.write_handles.lock().unwrap();
        let Some(wh) = handles.get_mut(&fh) else {
            reply.error(EIO);
            return;
        };

        let offset = offset as usize;
        let end = offset + data.len();
        if end > wh.buf.len() {
            wh.buf.resize(end, 0);
        }
        wh.buf[offset..end].copy_from_slice(data);
        reply.written(data.len() as u32);
    }

    fn release(
        &mut self,
        _req: &Request,
        ino: u64,
        fh: u64,
        _flags: i32,
        _lock_owner: Option<u64>,
        _flush: bool,
        reply: fuser::ReplyEmpty,
    ) {
        // If there's a write handle, upload to Drive
        let wh = self.write_handles.lock().unwrap().remove(&fh);
        if let Some(wh) = wh {
            if wh.buf.is_empty() {
                reply.ok();
                return;
            }
            let access = match self.get_token(&wh.account_id) {
                Ok((t, _, _)) => t,
                Err(_) => {
                    reply.error(EIO);
                    return;
                }
            };
            match self.rt.block_on(google_api::upload_file(
                &access,
                &wh.parent_drive_id,
                &wh.file_name,
                wh.buf,
                &wh.mime,
            )) {
                Ok(resp) => {
                    // Update inode with Drive ID and size
                    if let Some(id) = resp.get("id").and_then(|v| v.as_str()) {
                        let mut nodes = self.nodes.lock().unwrap();
                        if let Some(n) = nodes.get_mut(&ino) {
                            n.drive_id = Some(id.to_string());
                            if let Some(sz) = resp.get("size").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()) {
                                n.size = sz;
                            }
                        }
                    }
                    // Invalidate parent cache so next readdir re-fetches
                    {
                        let mut nodes = self.nodes.lock().unwrap();
                        let parent_ino = nodes.get(&ino).map(|n| n.parent_ino).unwrap_or(ROOT_INO);
                        if let Some(p) = nodes.get_mut(&parent_ino) {
                            p.children_loaded = false;
                        }
                    }
                    reply.ok();
                }
                Err(e) => {
                    log::warn!("[RiverFS] upload error: {}", crate::crypto::redact(&e));
                    reply.error(EIO);
                }
            }
        } else {
            reply.ok();
        }
    }

    fn mkdir(
        &mut self,
        _req: &Request,
        parent: u64,
        name: &OsStr,
        _mode: u32,
        _umask: u32,
        reply: ReplyEntry,
    ) {
        let name_str = name.to_string_lossy().to_string();
        let (account_id, account_email, parent_drive_id) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(pnode) = nodes.get(&parent) else {
                reply.error(ENOENT);
                return;
            };
            if !pnode.is_dir {
                reply.error(ENOTDIR);
                return;
            }
            let aid = pnode.account_id.clone().unwrap_or_default();
            let aemail = pnode.account_email.clone().unwrap_or_default();
            let pdid = pnode.drive_id.clone().unwrap_or("root".into());
            (aid, aemail, pdid)
        };
        if account_id.is_empty() {
            reply.error(EACCES);
            return;
        }

        {
            let idx = self.name_index.lock().unwrap();
            if idx.contains_key(&(parent, name_str.clone())) {
                reply.error(EEXIST);
                return;
            }
        }

        let access = match self.get_token(&account_id) {
            Ok((t, _, _)) => t,
            Err(_) => {
                reply.error(EIO);
                return;
            }
        };

        let resp = match self.rt.block_on(google_api::create_folder(
            &access,
            &parent_drive_id,
            &name_str,
        )) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[RiverFS] mkdir error: {}", crate::crypto::redact(&e));
                reply.error(EIO);
                return;
            }
        };

        let drive_id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let ino = self.alloc_ino();
        let node = FsNode {
            ino,
            name: name_str.clone(),
            drive_id: Some(drive_id),
            account_id: Some(account_id),
            account_email: Some(account_email),
            mime: "application/vnd.google-apps.folder".into(),
            is_dir: true,
            size: 0,
            parent_ino: parent,
            children_loaded: false,
            children_loaded_at: None,
        };
        let attr = node.attr();

        let mut nodes = self.nodes.lock().unwrap();
        nodes.insert(ino, node);
        let mut idx = self.name_index.lock().unwrap();
        idx.insert((parent, name_str), ino);

        reply.entry(&TTL, &attr, 0);
    }

    fn unlink(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: fuser::ReplyEmpty) {
        let name_str = name.to_string_lossy().to_string();
        let ino = {
            let idx = self.name_index.lock().unwrap();
            match idx.get(&(parent, name_str.clone())) {
                Some(&i) => i,
                None => {
                    reply.error(ENOENT);
                    return;
                }
            }
        };

        let (account_id, drive_id) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(node) = nodes.get(&ino) else {
                reply.error(ENOENT);
                return;
            };
            if node.is_dir {
                reply.error(EINVAL);
                return;
            }
            (
                node.account_id.clone().unwrap_or_default(),
                node.drive_id.clone().unwrap_or_default(),
            )
        };

        if !drive_id.is_empty() {
            let access = match self.get_token(&account_id) {
                Ok((t, _, _)) => t,
                Err(_) => {
                    reply.error(EIO);
                    return;
                }
            };
            if let Err(e) = self.rt.block_on(google_api::delete_file(&access, &drive_id)) {
                log::warn!("[RiverFS] delete error: {}", crate::crypto::redact(&e));
                reply.error(EIO);
                return;
            }
        }

        // Remove from indices
        let mut nodes = self.nodes.lock().unwrap();
        nodes.remove(&ino);
        let mut idx = self.name_index.lock().unwrap();
        idx.remove(&(parent, name_str));

        reply.ok();
    }

    fn rmdir(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: fuser::ReplyEmpty) {
        let name_str = name.to_string_lossy().to_string();
        let ino = {
            let idx = self.name_index.lock().unwrap();
            match idx.get(&(parent, name_str.clone())) {
                Some(&i) => i,
                None => {
                    reply.error(ENOENT);
                    return;
                }
            }
        };

        let (account_id, drive_id, is_dir) = {
            let nodes = self.nodes.lock().unwrap();
            let Some(node) = nodes.get(&ino) else {
                reply.error(ENOENT);
                return;
            };
            (
                node.account_id.clone().unwrap_or_default(),
                node.drive_id.clone().unwrap_or_default(),
                node.is_dir,
            )
        };

        if !is_dir {
            reply.error(ENOTDIR);
            return;
        }

        // Check empty (only attempt to load children once)
        self.ensure_dir_children(ino);
        let has_children = {
            let nodes = self.nodes.lock().unwrap();
            nodes.values().any(|n| n.parent_ino == ino && n.ino != ino)
        };
        if has_children {
            reply.error(ENOTEMPTY);
            return;
        }

        if !drive_id.is_empty() {
            let access = match self.get_token(&account_id) {
                Ok((t, _, _)) => t,
                Err(_) => {
                    reply.error(EIO);
                    return;
                }
            };
            if let Err(e) = self.rt.block_on(google_api::delete_file(&access, &drive_id)) {
                log::warn!("[RiverFS] rmdir error: {}", crate::crypto::redact(&e));
                reply.error(EIO);
                return;
            }
        }

        let mut nodes = self.nodes.lock().unwrap();
        nodes.remove(&ino);
        let mut idx = self.name_index.lock().unwrap();
        idx.remove(&(parent, name_str));

        reply.ok();
    }

    fn statfs(&mut self, _req: &Request, _ino: u64, reply: ReplyStatfs) {
        // Refresh pool quota from cached values
        self.ensure_root_children();
        let total = self.pool_total.load(Ordering::SeqCst);
        let used = self.pool_used.load(Ordering::SeqCst);
        let free = total.saturating_sub(used);

        let bsize = BLOCK_SIZE as u64;
        let total_blocks = total / bsize;
        let free_blocks = free / bsize;

        reply.statfs(
            total_blocks,  // blocks
            free_blocks,   // bfree
            free_blocks,   // bavail
            0,             // files (unlimited)
            0,             // ffree
            bsize as u32,  // bsize
            256,           // namelen
            BLOCK_SIZE,    // frsize
        );
    }

    fn getxattr(
        &mut self,
        _req: &Request<'_>,
        _ino: u64,
        _name: &OsStr,
        _size: u32,
        reply: ReplyXattr,
    ) {
        reply.error(ENODATA);
    }

    fn listxattr(&mut self, _req: &Request<'_>, _ino: u64, _size: u32, reply: ReplyXattr) {
        reply.size(0);
    }
}

/// Mount the pool filesystem at the given path. Blocks until unmounted.
/// Call from a dedicated thread.
pub fn mount_pool(
    db: Arc<Database>,
    mountpoint: &str,
    rt: tokio::runtime::Handle,
    shutdown: Arc<AtomicBool>,
) -> Result<(), String> {
    // If mountpoint already exists and was previously left mounted/dangling, clean up first
    let _ = unmount_pool(mountpoint);

    std::fs::create_dir_all(mountpoint)
        .map_err(|e| format!("Cannot create mountpoint {}: {}", mountpoint, e))?;

    let options_basic = vec![
        MountOption::FSName("RiverPool".into()),
        MountOption::Subtype("river".into()),
        MountOption::RO,
    ];

    log::info!("[RiverFS] Mounting pool at {}", mountpoint);

    let fs = RiverFS::new(db, rt, shutdown);
    fuser::mount2(fs, mountpoint, &options_basic)
        .map_err(|e| format!("FUSE mount failed: {}", e))
}

/// Unmount via fusermount3 -u (with lazy unmount -z fallback and umount fallback)
pub fn unmount_pool(mountpoint: &str) -> Result<(), String> {
    let mut err_msg = String::new();

    // 1. fusermount3 -u -z (lazy unmount as first-class to handle open file managers smoothly)
    if let Ok(output) = std::process::Command::new("fusermount3")
        .args(["-u", "-z", mountpoint])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.is_empty() {
            err_msg = stderr.trim().to_string();
        }
    }

    // 2. fusermount3 -u (standard)
    if let Ok(output) = std::process::Command::new("fusermount3")
        .args(["-u", mountpoint])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    // 3. fusermount -u
    if let Ok(output) = std::process::Command::new("fusermount")
        .args(["-u", mountpoint])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    // 4. fusermount -z -u
    if let Ok(output) = std::process::Command::new("fusermount")
        .args(["-z", "-u", mountpoint])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    // 5. umount -l (lazy)
    if let Ok(output) = std::process::Command::new("umount")
        .args(["-l", mountpoint])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    if err_msg.is_empty() {
        err_msg = "fusermount exited with non-zero status".into();
    }
    Err(format!("Unmount error: {}", err_msg))
}
