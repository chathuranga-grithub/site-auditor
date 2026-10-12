import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";
import { appVersion } from "@/lib/app-version";import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "SEO Toolkit", template: "%s · SEO Toolkit" },
  description: "Internal SEO and site health tools.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Who is signed in (the proxy already keeps signed-out visitors on /login).
  const session = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  // The version, at the bottom of the menu.
  const about = await appVersion();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell user={session ? { username: session.username, role: session.role, tools: session.tools } : null} about={about}>{children}</AppShell>
      </body>
    </html>
  );
}
