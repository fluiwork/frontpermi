// app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { cookies } from 'next/headers' // Cambia de headers a cookies
import ContextProvider from '@/context'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AppKit Example App',
  description: 'Powered by Reown'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Usa cookies() en lugar de headers() para obtener las cookies directamente
  const cookieStore = await cookies()
  const cookiesString = cookieStore.toString()

  return (
    <html lang="en">
      <body className={inter.className}>
        <ContextProvider cookies={cookiesString}>{children}</ContextProvider>
      </body>
    </html>
  )
}
