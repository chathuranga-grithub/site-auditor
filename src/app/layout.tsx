import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AUTH_CONFIGURED, auth } from "@/auth";
import { AppShell } from "@/components/shell/app-shell";
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
  title: { default: "Site Auditor", template: "%s · Site Auditor" },
  description: "Internal SEO and site health tools.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render per request so the signed-in user is always current (never a build-time snapshot).
  await connection();
  const session = AUTH_CONFIGURED ? await auth() : null;
  const user = session?.user?.email
    ? { email: session.user.email, name: session.user.name, image: session.user.image }
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
