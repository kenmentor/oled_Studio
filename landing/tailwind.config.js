/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#050505",
        panel: "#0c0c0e",
        card: "#101012",
        line: "#232326",
        fog: "#a1a1aa",
        dim: "#5b5b62",
        ember: "#ff5c0a",
        emberdim: "#a33c06",
        gold: "#ffb37a",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
