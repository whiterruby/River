// tailwind.config.js — River design system tokens mapped to CSS custom properties.
// Colors reference vars from index.css so light/dark switching is pure CSS.

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // toggled via class on <html>, not media query
  theme: {
    extend: {
      colors: {
        paper:     'var(--c-paper)',
        paperDeep: 'var(--c-paperDeep)',
        ink:       'var(--c-ink)',
        muted:     'var(--c-muted)',
        line:      'var(--c-line)',
        amberMirai:'var(--c-amberMirai)',
        amberDeep: 'var(--c-amberDeep)',
        terracotta:'var(--c-terracotta)',
        sage:      'var(--c-sage)',
        moss:      'var(--c-moss)',
        blush:     'var(--c-blush)',
        cream:     'var(--c-cream)',
        cardBg:    'var(--c-cardBg)',
        sidebarBg: 'var(--c-sidebarBg)',
        fileIcon:  'var(--c-fileIcon)',
        modalOverlay: 'var(--c-modalOverlay)',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        mirai: '24px', // large pill radius used across cards
      },
      boxShadow: {
        mirai: '0 8px 32px var(--shadow-mirai)',
        miraiHover: '0 12px 40px var(--shadow-miraiHover)',
      }
    },
  },
  plugins: [],
}
