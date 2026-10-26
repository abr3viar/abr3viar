import { ImageResponse } from "next/og";

// Ícone gerado no build (sem arquivo binário no repositório): balão de conversa com coração.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#b42a53",
          borderRadius: "22%",
        }}
      >
        <svg width="62%" height="62%" viewBox="0 0 24 24" fill="none">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-8Z" fill="#fff" />
          <path d="M12 13.2s-3.2-1.9-3.2-4a1.8 1.8 0 0 1 3.2-1.1A1.8 1.8 0 0 1 15.2 9.2c0 2.1-3.2 4-3.2 4Z" fill="#b42a53" />
        </svg>
      </div>
    ),
    size,
  );
}
