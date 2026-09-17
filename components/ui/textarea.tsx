import * as React from "react"
import { cn } from "cn"

// Même règle que le champ : rayon de contrôle, contour lisible.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-control border border-attenue bg-transparent px-3 py-2 text-base text-encre transition-colors placeholder:text-attenue disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
