export default {
  content: ["./index.html","./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT:"#1e3a5f", dark:"#162d4a", light:"#2a4f82" },
      },
      keyframes: {
        "slide-in": { "0%":{opacity:"0",transform:"translateX(1rem)"},"100%":{opacity:"1",transform:"translateX(0)"} },
        "scan":     { "0%,100%":{transform:"translateY(-80px)",opacity:"0.8"},"50%":{transform:"translateY(80px)",opacity:"0.8"} },
      },
      animation: {
        "slide-in": "slide-in 0.2s ease-out",
        "scan":     "scan 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
