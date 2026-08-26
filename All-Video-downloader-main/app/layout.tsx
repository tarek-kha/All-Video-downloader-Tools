import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "All-in-One Video Downloader",
  description: "Works with thousands of public video websites using multiple extraction methods. Support depends on website protection and availability.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}