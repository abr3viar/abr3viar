/** Limites de envio (UPLOAD_MAX_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES) para a checagem no navegador. O servidor continua conferindo. */
export type UploadLimits = { maxTotalBytes: number; maxImageBytes: number; maxImages: number };
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxTotalBytes: 25 * 1024 * 1024, maxImageBytes: 8 * 1024 * 1024, maxImages: 60 };
