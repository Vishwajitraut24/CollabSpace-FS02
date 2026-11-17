import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'CollabSpace — One workspace. Infinite possibilities.', description: 'A real-time collaborative workspace for documents, projects and teams.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
