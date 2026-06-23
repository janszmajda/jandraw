// Jandraw wordmark: an indigo rounded-square glyph (echoing Mercor's bold mark)
// next to the name. `size` scales the glyph; the wordmark is optional.
export default function Logo({
  size = "md",
  withText = true,
}: {
  size?: "sm" | "md" | "lg";
  withText?: boolean;
}) {
  const box =
    size === "lg" ? "h-9 w-9 text-lg" : size === "sm" ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="inline-flex select-none items-center gap-2">
      <span
        className={`grid ${box} place-items-center rounded-lg bg-accent font-semibold text-white shadow-sm`}
        aria-hidden
      >
        J
      </span>
      {withText && (
        <span className={`${text} font-semibold tracking-tight`}>Jandraw</span>
      )}
    </span>
  );
}
