/** 디자인 토큰은 설계서 §6 (목업 jipsa_dashboard_mockup.html과 동일) */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#141F2B",
        surface: "#1C2B3A",
        surface2: "#24384C",
        line: "#2E4255",
        red: "#BE2B25",
        redSoft: "#3A2530",
        blue: "#5C8CAD",
        ok: "#3E9C5C",
        text: "#EDF2F7",
        muted: "#8FA3B5",
      },
      borderRadius: { card: "12px", btn: "8px" },
      fontFamily: { sans: ["Pretendard", "system-ui", "sans-serif"] },
    },
  },
};
