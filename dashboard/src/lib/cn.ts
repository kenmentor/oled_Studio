export type ClassValue = string | false | null | undefined;

/** Tiny joiner: this app never passes arrays or objects into class names. */
export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(" ");
}