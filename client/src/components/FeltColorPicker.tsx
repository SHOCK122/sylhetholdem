import { SOCKET_EVENTS } from '@sylhet/shared';
import { emitWithAck } from '../socket';

export const FELT_PRESETS = [
  { name: 'Hunter Green', value: '#1e5631' },
  { name: 'Midnight Blue', value: '#1a3a5c' },
  { name: 'Burgundy', value: '#5c1a2e' },
  { name: 'Charcoal', value: '#2b2b2b' },
  { name: 'Royal Purple', value: '#3d1a5c' },
];

export function FeltColorPicker({ feltColor }: { feltColor: string }) {
  return (
    <div>
      <div className="table-settings-title">Table Felt Color</div>
      <div className="table-settings-swatches">
        {FELT_PRESETS.map((preset) => (
          <button
            key={preset.value}
            className={'swatch' + (feltColor === preset.value ? ' swatch-active' : '')}
            style={{ background: preset.value }}
            title={preset.name}
            onClick={() => emitWithAck(SOCKET_EVENTS.TABLE_SET_COLOR, { color: preset.value }).catch(() => {})}
          />
        ))}
        <input
          type="color"
          value={feltColor}
          onChange={(e) => emitWithAck(SOCKET_EVENTS.TABLE_SET_COLOR, { color: e.target.value }).catch(() => {})}
          className="swatch-custom"
        />
      </div>
    </div>
  );
}
