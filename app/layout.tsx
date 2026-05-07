import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { Session } from "../lib/session";
import { Theme } from "../lib/theme";
import "../styles/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Layers",
  description: "Unlock the power of layers.",
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Layers",
    images: ["/meta.png"],
    siteName: "Layers",
  },
};

const primaryFont = Instrument_Sans({ subsets: ['latin'], display: 'swap' })

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <Session>
          <Theme>
            {children}
          </Theme>
        </Session>
      </body>
    </html>
  );
}