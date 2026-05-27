/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        cm: {
          green: "var(--cm-green)",
          amber: "var(--cm-amber)",
          red: "var(--cm-red)",
          "green-soft": "var(--cm-green-soft)",
          "amber-soft": "var(--cm-amber-soft)",
          "red-soft": "var(--cm-red-soft)",
        },
      },
    },
  },
  plugins: [],
};
