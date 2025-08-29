// app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { headers } from 'next/headers'
import ContextProvider from '@/context'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AppKit Example App',
  description: 'Powered by Reown'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersObj = await headers()
  const cookies = headersObj.get('cookie') ?? null

  return (
    <html lang="en">
      <body className={inter.className}>
        <ContextProvider cookies={cookies}>{children}</ContextProvider>
      </body>
    </html>
  )
}
