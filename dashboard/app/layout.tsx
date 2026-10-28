import type { Metadata, Viewport } from "next";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "./globals.css";

const description = "Live trust scoring of GNSS positions for vehicle and drone fleets: spoofing and jamming detection with Galileo OSNMA, physical rules and unsupervised anomaly models.";
export const metadata: Metadata = {
  title: "TrustNav: GNSS trust monitoring",
  description,
  applicationName: "TrustNav",
  openGraph: { title: "TrustNav", description, type: "website", siteName: "TrustNav" },
  twitter: { card: "summary", title: "TrustNav", description },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
