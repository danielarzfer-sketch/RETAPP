import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retos & Deudas",
  description: "Control semanal de entrenamientos y deudas del grupo",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="bg-neutral-50 min-h-screen">{children}</body>
    </html>
  );
}
