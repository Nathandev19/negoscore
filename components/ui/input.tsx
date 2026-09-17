import * as React from "react"
import { cn } from "cn"

// Champ : un contrôle réel, donc rayon de contrôle. Contour encre : le bord
// d'un champ doit se voir (3:1 au moins sur la crème).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-control border-2 border-encre bg-creme px-3 py-1 text-base text-encre transition-colors placeholder:text-attenue disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
