"use client"

import type React from "react"
import { Music, Headphones, Radio, Video } from "lucide-react"

type Format = string

interface FormatDetails {
  label: string
  icon: React.ReactNode
  compatibility: number
  quality: number
  size: number
  color: string
}

const ALL_FORMATS: Record<Format, FormatDetails> = {
  mp3: {
    label: "MP3",
    icon: <Music className="w-4 h-4 sm:w-5 sm:h-5 text-white" />,
    compatibility: 100,
    quality: 80,
    size: 60,
    color: "from-green-500 to-emerald-500",
  },
  wav: {
    label: "WAV",
    icon: <Headphones className="w-4 h-4 sm:w-5 sm:h-5 text-white" />,
    compatibility: 70,
    quality: 100,
    size: 100,
    color: "from-blue-500 to-cyan-500",
  },
  mp4: {
    label: "MP4",
    icon: <Video className="w-4 h-4 sm:w-5 sm:h-5 text-white" />,
    compatibility: 100,
    quality: 95,
    size: 80,
    color: "from-red-500 to-orange-500",
  },
}

interface FormatSelectorProps {
  value: Format
  onChange: (format: Format) => void
  options: Format[]
}

const CompatibilityBar = ({ percentage, color }: { percentage: number; color: string }) => (
  <div className="w-full bg-slate-200 rounded-full h-1.5">
    <div
      className={`bg-gradient-to-r ${color} h-1.5 rounded-full transition-all duration-500`}
      style={{ width: `${percentage}%` }}
    />
  </div>
)

export function FormatSelector({ value, onChange, options }: FormatSelectorProps) {
  const availableFormats = options
    .map((option) => ({
      value: option,
      details: ALL_FORMATS[option],
    }))
    .filter((format) => format.details)

  const selectedFormatDetails = ALL_FORMATS[value]

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className={`grid grid-cols-${availableFormats.length === 1 ? 1 : 2} gap-2 sm:gap-3`}>
        {availableFormats.map((format) => (
          <button
            key={format.value}
            onClick={() => onChange(format.value)}
            className={`relative p-2 sm:p-3 rounded-xl border-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              value === format.value
                ? "bg-white border-slate-400 shadow-md focus:ring-slate-500"
                : "bg-slate-50 border-transparent hover:border-slate-200 focus:ring-slate-400"
            }`}
          >
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <div className={`p-1.5 sm:p-2 rounded-lg bg-gradient-to-r ${format.details.color}`}>
                {format.details.icon}
              </div>
              <div>
                <div className="font-semibold text-slate-800 text-sm sm:text-base">
                  {format.details.label}
                </div>
              </div>
            </div>
            {value === format.value && (
              <div className="absolute -top-1.5 -right-1.5 w-4 h-4 sm:w-5 sm:h-5 bg-slate-600 rounded-full border-2 border-white flex items-center justify-center">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full"></div>
              </div>
            )}
          </button>
        ))}
      </div>

      {selectedFormatDetails && (
        <div className="bg-slate-50 rounded-xl p-3 sm:p-4 border border-slate-100">
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <div className="text-center">
              <div className="text-slate-600 mb-1 text-xs">Compatibilidad</div>
              <CompatibilityBar
                percentage={selectedFormatDetails.compatibility}
                color={selectedFormatDetails.color}
              />
            </div>
            <div className="text-center">
              <div className="text-slate-600 mb-1 text-xs">Calidad</div>
              <CompatibilityBar
                percentage={selectedFormatDetails.quality}
                color={selectedFormatDetails.color}
              />
            </div>
            <div className="text-center">
              <div className="text-slate-600 mb-1 text-xs">Tamaño</div>
              <CompatibilityBar
                percentage={selectedFormatDetails.size}
                color={selectedFormatDetails.color}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
