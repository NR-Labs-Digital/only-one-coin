import QRCode from "qrcode";

/** The QR's printed width in CSS px (96 per inch): ~1.7 cm, inside the 2.4 cm bottom margin. */
const QR_WIDTH_PX = 64;

/**
 * The QR an issued document prints (OOC-59): the validation page's address for
 * its code, drawn as an inline SVG data URI. Drawn here, never fetched — a
 * document render must never reach the network (frame.ts).
 */
export async function verificationQrDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", width: QR_WIDTH_PX });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Where a code is checked: the portal's public validation page. */
export function verificationUrl(portalOrigin: string, code: string): string {
  return `${portalOrigin}/verificar/${encodeURIComponent(code)}`;
}
