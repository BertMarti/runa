import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * QR como `data:` en un `<img>`: nunca SVG insertado como HTML (Trusted Types).
 * Se genera en el propio navegador; el enlace no sale a ningún servicio.
 */
export function QrCode({ value, alt }: { value: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
      color: { dark: '#070a10ff', light: '#eef3f8ff' },
    })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div className="qr">{src ? <img className="qr__img" src={src} alt={alt} width={180} height={180} /> : <span className="qr__img qr__img--empty" />}</div>
  );
}
