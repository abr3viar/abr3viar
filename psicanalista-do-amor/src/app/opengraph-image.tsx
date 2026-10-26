import { ImageResponse } from "next/og";

export const alt = "Psicanalista do Amor — descubra o que está nas entrelinhas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #fdf2f4 0%, #f6c9d4 100%)",
          color: "#5e1730",
        }}
      >
        <div style={{ fontSize: 36, fontWeight: 700 }}>Psicanalista do Amor</div>
        <div style={{ fontSize: 68, fontWeight: 800, marginTop: 30, lineHeight: 1.1 }}>
          Cole a conversa, descubra o que está nas entrelinhas.
        </div>
        <div style={{ fontSize: 28, marginTop: 30, color: "#7c1d3c" }}>Análise da dinâmica entre duas pessoas feita por IA</div>
      </div>
    ),
    size,
  );
}
