/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#3b5bdb',
          600: '#364fc7',
          700: '#2f44ad',
          900: '#1e3a8a',
        },
        surface: '#f2f4ff',
        // JTC brand red (login page only - see src/pages/auth/Login.jsx).
        // Registered as a named theme color, not a bracket arbitrary value
        // (`ring-[#EE1C25]`), because this Tailwind setup's `ring` utility
        // does not generate arbitrary bracket colors - `ring-jtc` etc. do.
        // Purely additive: doesn't touch `primary`, used everywhere else.
        jtc: {
          DEFAULT: '#EE1C25',
          dark: '#CA181F', // ~15% darker, for hover/active states
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}