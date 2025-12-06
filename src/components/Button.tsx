import type { ReactNode, ButtonHTMLAttributes } from "react"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: "primary" | "secondary" | "danger" | "ghost"
  size?: "sm" | "md" | "lg"
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2"

  const variants = {
    primary:
      "bg-gradient-to-r from-slate-800 to-slate-700 text-white hover:from-slate-700 hover:to-slate-600 focus:ring-slate-500 shadow-lg hover:shadow-xl",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 border border-red-200",
    ghost: "text-gray-600 hover:bg-gray-50 focus:ring-gray-500",
  }

  const sizes = {
    sm: "px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm",
    md: "px-3 py-2 text-sm sm:px-4 sm:py-2.5",
    lg: "px-4 py-2.5 text-sm sm:px-6 sm:py-3 sm:text-base",
  }

  const disabledStyles = disabled ? "opacity-50 cursor-not-allowed" : ""

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${disabledStyles} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}