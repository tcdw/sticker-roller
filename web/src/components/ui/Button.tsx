import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";


export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "secondary" | "ghost" | "danger" }>(function Button({ className = "", variant = "default", ...props }, ref) {
  return <button ref={ref} className={`ui-button ui-${variant} ${className}`} {...props} />;
});
