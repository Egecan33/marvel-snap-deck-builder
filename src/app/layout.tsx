import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Shell } from './components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Snap Forge',
  description: 'Brew, build, score, rate and theorycraft Marvel Snap decks. Unofficial fan project.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
