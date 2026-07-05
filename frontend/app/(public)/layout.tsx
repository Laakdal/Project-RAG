'use client';

import React, { useEffect } from 'react';
import "../globals.css";
import { ToastContainer } from '@/app/components/feedback';
import { ThemeProvider, ThemeScript } from '@/app/components/theme-provider';
import { AuthHydrator } from '@/lib/store/auth-hydrator';
import { ServerUrlGuard } from '@/app/components/electron/server-url-setup';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.title = 'Palmco GPT';
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined|Material+Icons"
          rel="stylesheet"
        />
      </head>
      <body style={{ backgroundColor: 'var(--olive-1, #f8f8f5)' }}>
        <ThemeProvider>
          <AuthHydrator />
          <ServerUrlGuard>{children}</ServerUrlGuard>
          <ToastContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}

