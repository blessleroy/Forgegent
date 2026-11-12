export const metadata = {
  title: "Forgegent",
  description: "Build Agents. Ship Applications.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
