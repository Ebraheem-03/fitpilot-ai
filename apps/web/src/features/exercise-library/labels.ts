/** "front_45" → "front 45", joined for display: ["quadriceps","glutes"] → "Quadriceps, glutes". */
export function listLabel(values: readonly string[], empty: string): string {
  if (values.length === 0) return empty;
  const text = values.map((v) => v.replaceAll("_", " ")).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
