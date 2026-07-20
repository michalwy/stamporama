import type { Metadata } from "next";
import { ThemeProvider } from "@/app/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Stamporama",
    template: "%s — Stamporama"
  },
  description: "Self-hosted web application for stamp collectors."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
