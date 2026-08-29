import { useState } from 'react';
import { QRCodeDisplay } from './QRCodeDisplay';

export function RoomQrPanel({ roomCode, joinUrl, size = 168 }: { roomCode: string; joinUrl: string; size?: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(joinUrl);
      } else {
        // navigator.clipboard needs a secure context; fall back for plain-HTTP LAN access.
        const textarea = document.createElement('textarea');
        textarea.value = joinUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  return (
    <div className="table-qr-panel">
      <QRCodeDisplay url={joinUrl} size={size} />
      <button
        type="button"
        className="table-qr-code table-qr-code-btn"
        onClick={handleCopy}
        title="Copy join link"
      >
        {roomCode}
      </button>
      <div className="table-qr-hint">{copied ? 'Link copied!' : 'Scan or click code to join'}</div>
    </div>
  );
}
