import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "СППВР — Система поддержки врачебных решений",
  description:
    "Локальная мультимодальная система поддержки принятия врачебных решений с элементами генетического анализа и генеративного ИИ. Соответствие ФЗ-152.",
  keywords: [
    "CDSS",
    "медицина",
    "ИИ",
    "генетика",
    "RAG",
    "врачебные решения",
    "ФЗ-152",
  ],
  authors: [{ name: "СППВР" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <SonnerToaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
