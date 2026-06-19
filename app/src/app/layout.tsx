import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Panelshift",
  title: "Panelshift",
  description: "Responsive Komga-backed comic and webtoon reader",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Panelshift",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/icons/panelshift.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icons/panelshift.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/panelshift-maskable.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#151713",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
