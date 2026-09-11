import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YourPMS — Practice Management',
  description: 'YourPMS — multi-tenant practice management and billing for South African medical practices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
