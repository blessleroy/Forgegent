import { getMe } from "@/lib/me";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forgegent 智体工坊",
  description: "Build Agents. Ship Applications.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  void getMe;
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
