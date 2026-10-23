// Semantic colors backed by the CSS tokens in src/styles/theme-tokens.css, so a season pack can
// restyle migrated screens (bg-surface, text-ink-muted, bg-accent/20 ...) without touching them.
const token = name => `rgb(var(--np-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        surface: token('surface'),
        glass: token('glass'),
        ink: {
          DEFAULT: token('ink'),
          soft: token('ink-soft'),
          muted: token('ink-muted'),
          faint: token('ink-faint'),
        },
        line: token('line'),
        accent: {
          DEFAULT: token('accent'),
          ink: token('accent-ink'),
          soft: token('accent-soft'),
          strong: token('accent-strong'),
        },
        chip: {
          DEFAULT: token('chip'),
          hover: token('chip-hover'),
        },
      },
    },
  },
  plugins: [],
}
