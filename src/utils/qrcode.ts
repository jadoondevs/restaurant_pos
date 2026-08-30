/**
 * Local QR code generation for the receipt's Google Review link — entirely
 * offline, no external service call (qrcode-generator is a pure, dependency-
 * free encoder). Mirrors the compressImage/parseCsvRows convention: a small
 * self-contained utility rather than a network-backed QR image service.
 */
import qrcode from 'qrcode-generator';

/**
 * Builds a scalable SVG <svg> tag for the given text. Sized via viewBox so
 * it can be constrained by CSS in the receipt template (mm-based, matches
 * the rest of receipt.ts's print-oriented units).
 */
export function buildQrCodeSvg(text: string): string {
  const qr = qrcode(0, 'M'); // 0 = auto-detect the smallest version that fits
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}
