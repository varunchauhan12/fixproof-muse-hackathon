import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { ActivityProvider } from "@/context/ActivityContext";
import { AppStatusIsland } from "@/components/ui/AppStatusIsland";

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "FixProof — AI Video Copyright Protection & Digital Forensics Console",
  description: "Enterprise video fingerprinting, FAISS reference vault, and Sentinel-grade visual matching.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full dark ${bricolageGrotesque.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${bricolageGrotesque.className} min-h-full flex flex-col antialiased`} suppressHydrationWarning>
        <ActivityProvider>
          {children}
          <AppStatusIsland />
        </ActivityProvider>
      </body>
    </html>
  );
}
