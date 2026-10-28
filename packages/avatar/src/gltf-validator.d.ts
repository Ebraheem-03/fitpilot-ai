// Minimal typing for the parts of gltf-validator we use (the package ships no types).
declare module "gltf-validator" {
  interface ValidationMessage {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
  }
  interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; messages: ValidationMessage[] };
  }
  export function validateBytes(
    data: Uint8Array,
    options?: { maxIssues?: number },
  ): Promise<ValidationReport>;
}
