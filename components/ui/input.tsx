import * as React from "react"
import { cn } from "cn"

// Champ : un contrôle réel, donc rayon de 6 px. Bordure en atténué et non en
// filet : le contour d'un champ doit se voir (3:1 au moins sur le papier).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-control border border-attenue bg-transparent px-3 py-1 text-base text-encre transition-colors placeholder:text-attenue disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
