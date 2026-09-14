'use client'

import { useState, useEffect } from 'react'

export default function SplashScreen({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [fadeState, setFadeState] = useState(false) // false = solid, true = fading

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout>;
    
    // Hold the splash screen for 1.8 seconds, then fade out smoothly
    const timer = setTimeout(() => {
      setFadeState(true)
      
      // Completely remove the splash screen from DOM after fade completes
      fadeTimer = setTimeout(() => setIsLoading(false), 500) 
    }, 1800)
    
    // 🔥 CLOSURE FIX: Safely clear both timers to prevent unmounted state updates
    return () => {
      clearTimeout(timer);
      if (fadeTimer) clearTimeout(fadeTimer);
    }
  }, [])

  return (
    <>
      {isLoading && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            opacity: fadeState ? 0 : 1,
            transition: 'opacity 0.5s ease',
          }}
        >
          {/* Your Logo */}
          <img 
            src="https://i.imgur.com/s0hg3MQ.png" 
            alt="Angkor Radiant Rice Logo" 
            style={{ width: '140px', height: 'auto', marginBottom: '30px' }} 
            crossOrigin="anonymous"
          />
          
          {/* Animated CSS Loading Bar */}
          <div style={{ width: '200px', height: '4px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div 
              style={{ 
                height: '100%', 
                background: '#10b981', 
                animation: 'loadProgress 1.8s ease-out forwards' 
              }} 
            />
          </div>

          <style jsx>{`
            @keyframes loadProgress {
              0% { width: 0%; }
              50% { width: 70%; }
              100% { width: 100%; }
            }
          `}</style>
        </div>
      )}
      
      {/* 🔥 UX/PWA FIX: Removed display 'none'. Let the app silently hydrate and calculate layout behind the splash screen! */}
      <div style={{ height: '100%', width: '100%' }}>
        {children}
      </div>
    </>
  )
}