import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Booking x Gamerarena",
  description: "GTA VI Pre-Booking & Slot Management Dashboard for Gamerarena",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}