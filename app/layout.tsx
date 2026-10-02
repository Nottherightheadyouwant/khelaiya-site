import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#2b1427",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Khelaiya — Find Your Garba Night · Ahmedabad & Gandhinagar",
  description:
    "Discover 13 verified Navratri and Garba events across Ahmedabad and Gandhinagar. Lock authorized vendor passes with 20-minute reservation and direct UPI checkout.",
  keywords: [
    "Navratri 2026",
    "Garba Ahmedabad",
    "Garba Gandhinagar",
    "Swarnim Nagari",
    "Parampara Navratri",
    "Kirtidan Gadhvi",
    "Aishwarya Majmudar",
    "Kinjal Dave",
    "Falguni Pathak",
    "Garba City GIFT City",
    "Khelaiya passes",
  ],
  openGraph: {
    title: "Khelaiya — Find Your Garba Night · Navratri 2026",
    description:
      "Explore 13 grand garba celebrations in Ahmedabad & Gandhinagar. Instant 20-minute pass lock & direct UPI checkout.",
    siteName: "Khelaiya",
    locale: "en_IN",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
