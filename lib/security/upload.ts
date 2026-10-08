import "server-only";

export interface FileValidationResult {
  valid: boolean;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
  extension?: "jpg" | "png" | "webp";
  error?: string;
}

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validates an uploaded image file by verifying its true magic bytes / signature,
 * rather than relying solely on the client-supplied MIME type.
 */
export async function validateImageFile(file: File): Promise<FileValidationResult> {
  if (!(file instanceof File) || file.size <= 0) {
    return { valid: false, error: "Empty or invalid file." };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { valid: false, error: "File exceeds 5MB size limit." };
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, 16));

  // Check JPEG signature: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, mimeType: "image/jpeg", extension: "jpg" };
  }

  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { valid: true, mimeType: "image/png", extension: "png" };
  }

  // Check WebP signature: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { valid: true, mimeType: "image/webp", extension: "webp" };
  }

  return { valid: false, error: "File header does not match a valid JPEG, PNG, or WebP image." };
}
