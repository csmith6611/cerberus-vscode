// Illustrative root layout: the extension reads these static attributes to pick the theme variant and swatch mode.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-panda-theme="elysium" data-color-mode="dark">
      <body>{children}</body>
    </html>
  );
}
