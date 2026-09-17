import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Deux formes d'action seulement. default : l'action primaire, bouton plein
// encre, une seule visible par écran. link : tout le reste, souligné en encre.
// Pas de bouton contour, secondaire ou coloré. Le focus est le contour global
// de app/globals.css.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-control border border-encre bg-encre text-papier hover:border-encre-douce hover:bg-encre-douce disabled:border-filet disabled:bg-transparent disabled:text-attenue",
        link: "text-encre underline decoration-1 underline-offset-4 hover:decoration-2 disabled:text-attenue",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-11 px-6",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto min-h-11 px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
