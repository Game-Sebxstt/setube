"use client"

import { useEffect } from "react"
import { AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/Button"

interface ErrorToastProps {
  message: string
  onClose: () => void
  duration?: number
}

export function ErrorToast({ message, onClose, duration = 5000 }: ErrorToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose()
    }, duration)

    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-auto z-50 animate-in slide-in-from-top-2 duration-300">
      <div className="bg-white border border-red-200 rounded-xl shadow-lg p-4 max-w-md mx-auto sm:mx-0">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-100 rounded-lg flex-shrink-0">
            <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-red-800 mb-1 text-sm sm:text-base">Error</h3>
            <p className="text-xs sm:text-sm text-red-600 break-words">{message}</p>
          </div>
          <Button onClick={onClose} variant="ghost" size="sm" className="p-1 h-auto flex-shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
