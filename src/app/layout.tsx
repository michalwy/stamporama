import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stamporama",
  description: "Self-hosted web application for stamp collectors."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
