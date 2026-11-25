export interface OcrItem { description: string; amountInCents: number }
/**
 * OCR stub — returns an empty item list so the user itemizes manually.
 * TODO: plug in Tesseract or Google Vision here and map lines to OcrItem[].
 */
export async function ocrReceipt(_filePath: string): Promise<OcrItem[]> {
  return [];
}
