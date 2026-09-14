import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Lighter Weekly", template: "%s · Lighter Weekly" },
  description: "Track Robinhood Lighter weekly volume, points and hypothetical LIT value scenarios.",
  applicationName: "Lighter Weekly",
  authors: [{ name: "Smart Drop Farmer", url: "https://x.com/SmartDropFarmer" }],
  openGraph: {
    title: "Lighter Weekly",
    description: "Your Robinhood Lighter activity, week by week.",
    type: "website",
    images: [{ url: "/share-bg-energy.jpg", width: 1672, height: 941, alt: "Lighter Weekly dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lighter Weekly",
    description: "Track weekly volume, points and hypothetical LIT value scenarios.",
    creator: "@SmartDropFarmer",
    images: ["/share-bg-energy.jpg"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
