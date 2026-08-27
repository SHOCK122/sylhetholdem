import { QRCodeDisplay } from './QRCodeDisplay';

export function RoomQrPanel({ roomCode, joinUrl, size = 168 }: { roomCode: string; joinUrl: string; size?: number }) {
  return (
    <div className="table-qr-panel">
      <QRCodeDisplay url={joinUrl} size={size} />
      <div className="table-qr-code">{roomCode}</div>
      <div className="table-qr-hint">Scan to join</div>
    </div>
  );
}
