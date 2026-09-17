import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Formes d'action. default : l'action principale, plein bleu marque, une par
// écran. outline : action secondaire, contour encre. destructive : action sans
// retour, contour « bad ». link : lien souligné bleu. Désactivé : bleu marque
// désaturé pour l'action principale (la marque est visible dès l'arrivée),
// plein atténué pour les autres ; texte crème. Le focus est le contour global de app/globals.css.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "rounded-control border-2 border-marque bg-marque text-creme hover:border-marque-deep hover:bg-marque-deep disabled:border-marque-muted disabled:bg-marque-muted disabled:text-creme",
        outline:
          "rounded-control border-2 border-encre bg-transparent text-encre hover:bg-encre hover:text-creme disabled:border-attenue disabled:bg-attenue disabled:text-creme",
        destructive:
          "rounded-control border-2 border-band-bad-on-creme bg-transparent text-encre hover:bg-band-bad-on-creme disabled:border-attenue disabled:bg-attenue disabled:text-creme",
        link: "text-marque underline decoration-2 underline-offset-4 hover:text-marque-deep disabled:text-attenue",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 gap-1.5 px-3",
        lg: "h-12 px-6 text-base",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto min-h-11 px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Bouton indisponible mais qui reste au clavier (aria-disabled, mission #062
// A12) : il doit se voir comme un bouton désactivé sans l'attribut disabled,
// qui le sortirait de l'ordre de tabulation et le rendrait muet. Les mêmes
// couleurs que disabled:, forcées pour passer devant le survol.
const ARIA_DISABLED: Record<string, string> = {
  default: "border-marque-muted! bg-marque-muted! text-creme! cursor-default",
  outline: "border-attenue! bg-attenue! text-creme! cursor-default",
  destructive: "border-attenue! bg-attenue! text-creme! cursor-default",
  link: "text-attenue! cursor-default",
}

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
  const inert = props["aria-disabled"] === true || props["aria-disabled"] === "true"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }), inert ? ARIA_DISABLED[variant ?? "default"] : null)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
