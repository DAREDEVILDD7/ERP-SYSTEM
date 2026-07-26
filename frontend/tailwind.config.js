/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // JTC brand palette — `primary` is the app's canonical accent scale,
        // now anchored on the official brand red #EE1C25. Every `bg-primary-*`,
        // `text-primary-*`, `ring-primary-*`, `border-primary-*` and
        // `focus:ring-primary-*` class already in the codebase automatically
        // adopts the new brand color, so recoloring the shell is centralized
        // here rather than fanned out across pages. Shade ladder is designed
        // to preserve WCAG contrast against white/gray backgrounds at each
        // step (50/100 for surfaces, 500 for solid buttons, 600 for hover,
        // 700 for active/pressed, 900 for deep text/on-dark accents).
        primary: {
          50:  '#FEF2F2',
          100: '#FEE2E2',
          500: '#EE1C25', // JTC Brand Red — solid buttons, active states
          600: '#CA181F', // hover
          700: '#A5141A', // active / pressed
          900: '#5C0A0F', // deep accent
        },
        surface: '#f2f4ff',
        // Preserved legacy blue scale — kept ONLY for the Dispatch module,
        // which is intentionally excluded from the JTC brand rollout. The
        // Dispatch page consumes these classes (`dispatch-50`/`-500`/etc.)
        // so its visual identity is bit-exact identical to the previous
        // primary-blue implementation. Do not use these classes outside
        // Dispatch — the rest of the app must go through `primary-*`.
        dispatch: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          300: '#a5b4fc',
          400: '#6474e2',
          500: '#3b5bdb',
          600: '#364fc7',
          700: '#2f44ad',
          800: '#233784',
          900: '#1e3a8a',
        },
        // JTC brand red alias — historical name retained (used explicitly
        // on the login page's ring utilities). Points at the same brand
        // tokens as the primary scale.
        jtc: {
          DEFAULT: '#EE1C25',
          dark: '#CA181F',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}