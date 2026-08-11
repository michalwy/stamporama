import type { Metadata } from "next";
import { ThemeProvider } from "@/app/theme-provider";
import { ToastProvider } from "@/app/toast-provider";
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
        {/* Confirmation toasts (#541) live in the **root** layout, not the collection one: the
            settings screens, the collections list and the sign-in shell all take actions worth
            confirming, and a provider mounted per section is one every new section has to remember
            to mount. Inside the theme provider, so a toast reads in the theme it appears over. */}
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
