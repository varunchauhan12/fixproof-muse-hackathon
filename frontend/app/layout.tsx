import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
