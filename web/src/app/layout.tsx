import type { Metadata } from "next";
import { DM_Serif_Display, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const serif = DM_Serif_Display({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
});

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Mathesis",
  description: "RSM practice worksheet generator & progress tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full`}>
      <body className="min-h-full flex bg-background text-foreground antialiased">
        <Sidebar />
        <main className="flex-1 ml-64 min-h-screen">
          <div className="max-w-6xl mx-auto px-8 py-10">{children}</div>
        </main>
      </body>
    </html>
  );
}
