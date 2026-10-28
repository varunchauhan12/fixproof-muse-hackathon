import type { Metadata } from "next";
import "./globals.css";
import { ActivityProvider } from "@/context/ActivityContext";
import { AppStatusIsland } from "@/components/ui/AppStatusIsland";

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
    <html lang="en" className="h-full dark" suppressHydrationWarning>
      <body className="min-h-full flex flex-col antialiased" suppressHydrationWarning>
        <ActivityProvider>
          {children}
          <AppStatusIsland />
        </ActivityProvider>
      </body>
    </html>
  );
}
