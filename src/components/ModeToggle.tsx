"use client"

import { List, ListMusic } from "lucide-react"

type ConversionMode = "urls" | "playlist"

interface ModeToggleProps {
  mode: ConversionMode
  onChange: (mode: ConversionMode) => void
}

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="flex bg-gray-100 rounded-xl p-1 relative">
      <div
        className={`absolute top-1 bottom-1 w-1/2 bg-white rounded-lg shadow-sm transition-all duration-300 ease-out ${
          mode === "playlist" ? "translate-x-full" : "translate-x-0"
        }`}
      />

      <button
        onClick={() => onChange("urls")}
        className={`relative z-10 flex-1 flex items-center justify-center gap-1 sm:gap-2 py-2 sm:py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 ${
          mode === "urls" ? "text-slate-700" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <List className="w-3 h-3 sm:w-4 sm:h-4" />
        <span className="hidden xs:inline">URLs Individuales</span>
        <span className="xs:hidden">URLs</span>
      </button>

      <button
        onClick={() => onChange("playlist")}
        className={`relative z-10 flex-1 flex items-center justify-center gap-1 sm:gap-2 py-2 sm:py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 ${
          mode === "playlist" ? "text-slate-700" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <ListMusic className="w-3 h-3 sm:w-4 sm:h-4" />
        <span className="hidden xs:inline">Playlist Completa</span>
        <span className="xs:hidden">Playlist</span>
      </button>
    </div>
  )
}
