// Custom SVG icon set with an autumn/nature theme. Used across the app for
// file type indicators, branding, and decorative elements.
import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
}

// -- Decorative / branding icons --

export const MapleLeafIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C12 2 10 5 8 6.5C6 8 3 8 3 8C3 8 4.5 10.5 5 12C5.5 13.5 4 16 4 16C4 16 7 15 9 15.5C11 16 12 18 12 18C12 18 13 16 15 15.5C17 15 20 16 20 16C20 16 18.5 13.5 19 12C19.5 10.5 21 8 21 8C21 8 18 8 16 6.5C14 5 12 2 12 2Z" fill="currentColor" opacity="0.85"/>
    <path d="M12 18V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M12 14L10 12M12 14L14 12M12 10L10.5 8M12 10L13.5 8" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4"/>
  </svg>
);

export const WindLeafIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M4 12C4 12 6 8 10 7C14 6 17 8 19 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4"/>
    <path d="M3 16C3 16 5 13 9 12.5C13 12 16 13.5 20 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
    <path d="M16 9C16 9 14.5 11.5 12.5 12.5C10 14 8 13.5 7 15C6 16.5 7 18.5 9 19C11 19.5 13 18 14 16.5C15 15 15.5 13.5 17.5 12C19 10.8 21 11 21 11" fill="currentColor" opacity="0.8"/>
    <path d="M14 16.5C14 16.5 12 15 11 13.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4"/>
    <path d="M9 19L7 21.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

export const BranchIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M4 20C4 20 6 16 8 14C10 12 13 11 15 9C17 7 18 4 18 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    <path d="M10 13C10 13 8 11 8.5 9C9 7 11 6.5 11 6.5" fill="currentColor" opacity="0.7"/>
    <path d="M14 10C14 10 13 8 14 6.5C15 5 16.5 5 16.5 5" fill="currentColor" opacity="0.6"/>
    <path d="M8 15C8 15 6 14 5 15.5C4 17 5.5 18 5.5 18" fill="currentColor" opacity="0.65"/>
    <path d="M15 8.5C15 8.5 17 9.5 18.5 8.5C20 7.5 19.5 6 19.5 6" fill="currentColor" opacity="0.55"/>
    <circle cx="7" cy="12" r="0.8" fill="currentColor" opacity="0.4"/>
    <circle cx="16" cy="6.5" r="0.7" fill="currentColor" opacity="0.35"/>
  </svg>
);

export const AcornIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3C12 3 10 4 9 4.5C8 5 7 5 7 5L12 6L17 5C17 5 16 5 15 4.5C14 4 12 3 12 3Z" fill="currentColor" opacity="0.5"/>
    <path d="M7 7C7 7 6.5 6 7 5L12 6L17 5C17.5 6 17 7 17 7" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="7" y="6" width="10" height="4" rx="2" fill="currentColor" opacity="0.45"/>
    <path d="M8 10C8 10 7.5 14 9 16.5C10.5 19 12 19.5 12 19.5C12 19.5 13.5 19 15 16.5C16.5 14 16 10 16 10" fill="currentColor" opacity="0.8"/>
    <path d="M12 19.5V22" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M12 10V16" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" opacity="0.3"/>
  </svg>
);

// Used as progress indicator on the pool storage bar
export const FallingLeafIcon: React.FC<IconProps> = ({ className = '', size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M17 3C17 3 14 5 11 8C8 11 6 14 5 17C4 20 5 21 5 21C5 21 8 20 11 17C14 14 16 11 18 8C20 5 19 3 17 3Z" fill="currentColor" opacity="0.85"/>
    <path d="M17 3C15 6 11 10 8 14C5 18 5 21 5 21" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.4"/>
    <path d="M14 7L11 11M16 6L12 9" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" opacity="0.25"/>
  </svg>
);

// App logo - maple leaf over river waves
export const RiverLeafLogo: React.FC<IconProps> = ({ className = '', size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M4 24C8 22 12 26 16 24C20 22 24 26 28 24C32 22 36 24 36 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    <path d="M6 28C10 26 14 30 18 28C22 26 26 30 30 28C34 26 37 28 37 28" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.35"/>
    <path d="M20 6C20 6 18 8.5 16 9.5C14 10.5 12 10.5 12 10.5C12 10.5 13 12 13.5 13C14 14 13 16 13 16C13 16 15 15.5 16.5 15.5C18 15.5 20 18 20 18C20 18 22 15.5 23.5 15.5C25 15.5 27 16 27 16C27 16 26 14 26.5 13C27 12 28 10.5 28 10.5C28 10.5 26 10.5 24 9.5C22 8.5 20 6 20 6Z" fill="currentColor" opacity="0.9"/>
    <path d="M20 18V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

// -- Theme toggle icons --

export const SunIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" opacity="0.85"/>
  </svg>
);

// -- Pool / storage icons --

// Shield-shaped icon with inner leaf motif, used in the storage summary card
export const StorageCrestIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3C12 3 8 5 5 6C5 6 4 12 5 15C6 18 9 20 12 22C15 20 18 18 19 15C20 12 19 6 19 6C16 5 12 3 12 3Z" fill="currentColor" opacity="0.10"/>
    <path d="M12 3C12 3 8 5 5 6C5 6 4 12 5 15C6 18 9 20 12 22C15 20 18 18 19 15C20 12 19 6 19 6C16 5 12 3 12 3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity="0.38"/>
    <path d="M12 8C12 8 11 9 10 9.5C9 10 8.5 10 8.5 10C8.5 10 9 11 9.2 11.5C9.5 12 9 13 9 13C9 13 10 12.8 10.8 12.8C11.5 12.8 12 14 12 14C12 14 12.5 12.8 13.2 12.8C14 12.8 15 13 15 13C15 13 14.5 12 14.8 11.5C15 11 15.5 10 15.5 10C15.5 10 15 10 14 9.5C13 9 12 8 12 8Z" fill="currentColor" opacity="0.55"/>
    <path d="M12 14V17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.32"/>
  </svg>
);

// -- File type icons (used in file listings) --

export const AutumnFolderIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6C3 4.9 3.9 4 5 4H9.5L11.5 6H19C20.1 6 21 6.9 21 8V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6Z" fill="currentColor" opacity="0.34"/>
    <path d="M3 6C3 4.9 3.9 4 5 4H9.5L11.5 6H19C20.1 6 21 6.9 21 8V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.62"/>
    <path d="M14.2 11.2C14.2 11.2 13.4 12 12.6 12.4C11.6 12.8 11.1 12.6 10.6 13C10.1 13.4 10.6 14.3 11.2 14.6C11.9 14.8 12.7 14.2 13 13.5C13.2 13 13.6 12.6 14.4 12.1C15 11.7 15.6 11.6 15.6 11.6" fill="currentColor" opacity="0.58"/>
  </svg>
);

export const AutumnFileIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" fill="currentColor" opacity="0.32"/>
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <path d="M14 3V8H19" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <path d="M13 12C13 12 12.2 13 11.5 13.2C10.5 13.5 10 13.2 9.7 13.7C9.3 14.2 9.8 14.8 10.3 15C11 15.2 11.5 14.7 12 14C12.3 13.5 12.8 13.2 13.5 12.8C14 12.5 14.5 12.5 14.5 12.5" fill="currentColor" opacity="0.52"/>
  </svg>
);

export const AutumnPdfIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" fill="currentColor" opacity="0.32"/>
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <path d="M14 3V8H19" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <rect x="7" y="13" width="10" height="6" rx="1.4" fill="currentColor" opacity="0.38"/>
    <text x="12" y="17.5" textAnchor="middle" fill="currentColor" fontSize="5.2" fontWeight="700" fontFamily="serif" opacity="1">PDF</text>
  </svg>
);

export const AutumnTextIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" fill="currentColor" opacity="0.32"/>
    <path d="M6 3C5.45 3 5 3.45 5 4V20C5 20.55 5.45 21 6 21H18C18.55 21 19 20.55 19 20V8L14 3H6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <path d="M14 3V8H19" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.58"/>
    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.72"/>
    <line x1="8" y1="14.6" x2="14" y2="14.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.52"/>
    <line x1="8" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.38"/>
  </svg>
);

export const AutumnVideoIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="5" width="18" height="14" rx="3" fill="currentColor" opacity="0.32"/>
    <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.58"/>
    <path d="M10 9L16 12L10 15V9Z" fill="currentColor" opacity="0.88"/>
  </svg>
);

export const AutumnMusicIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M9 18V6L19 4V16" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.58"/>
    <circle cx="6.5" cy="18" r="2.5" fill="currentColor" opacity="0.36"/>
    <circle cx="6.5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.2" opacity="0.58"/>
    <circle cx="16.5" cy="16" r="2.5" fill="currentColor" opacity="0.36"/>
    <circle cx="16.5" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.2" opacity="0.58"/>
  </svg>
);

export const AutumnImageIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" opacity="0.32"/>
    <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.2" opacity="0.58"/>
    <circle cx="8.5" cy="9.5" r="2" fill="currentColor" opacity="0.62"/>
    <path d="M3 16L8 12L12 15L16 11L21 15V17C21 18.66 19.66 20 18 20H6C4.34 20 3 18.66 3 17V16Z" fill="currentColor" opacity="0.42"/>
  </svg>
);
