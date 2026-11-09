import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Organicin's brand typeface, used on the update "page" in the editor (OS-02 Brand Guide).
const nunitoSans = localFont({
  variable: "--font-nunito-sans",
  display: "swap",
  src: [
    { path: "../fonts/nunito-sans-latin-400-normal.woff", weight: "400", style: "normal" },
    { path: "../fonts/nunito-sans-latin-400-italic.woff", weight: "400", style: "italic" },
    { path: "../fonts/nunito-sans-latin-700-normal.woff", weight: "700", style: "normal" },
    { path: "../fonts/nunito-sans-latin-700-italic.woff", weight: "700", style: "italic" },
    { path: "../fonts/nunito-sans-latin-900-normal.woff", weight: "900", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Investor Updates", template: "%s · Investor Updates" },
  description: "Investor communications for Organicin Scientific",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${nunitoSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
