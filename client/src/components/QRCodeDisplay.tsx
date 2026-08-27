import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export function QRCodeDisplay({ url, size = 220 }: { url: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 1,
      color: { dark: '#0c0c0c', light: '#f7f4ec' },
    }).catch(() => {});
  }, [url, size]);

  return <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: 10, display: 'block' }} />;
}
