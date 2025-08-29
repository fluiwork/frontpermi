// config/index.tsx
import { cookieStorage, createStorage } from '@wagmi/core'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, base, scroll, polygon } from '@reown/appkit/networks'

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID
if (!projectId) throw new Error('Project ID is not defined')

export const networks = [mainnet, arbitrum, base, scroll, polygon]

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  // cuidado con `ssr`: AppKit no lo soporta completamente; leer recomendación abajo.
  ssr: false,
  projectId,
  networks
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
