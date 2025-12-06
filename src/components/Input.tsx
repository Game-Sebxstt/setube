import type { InputHTMLAttributes } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export function Input({ className = "", error, ...props }: InputProps) {
  const baseStyles =
    "w-full px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 text-sm sm:text-base text-gray-800"
  const normalStyles = "border-gray-200 focus:border-slate-400 focus:ring-slate-400/20"
  const errorStyles = "border-red-300 focus:border-red-400 focus:ring-red-400/20"

  return <input className={`${baseStyles} ${error ? errorStyles : normalStyles} ${className}`} {...props} />
}
