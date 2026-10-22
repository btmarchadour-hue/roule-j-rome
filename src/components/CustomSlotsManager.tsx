import React, { useState } from 'react';
import { AppSettings, CustomSlot, CustomSlotsMap, WindPoint } from '../types';
import { sw, toU } from '../utils/tides';

interface CustomSlotsManagerProps {
  dateStr: string;
  settings: AppSettings;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  onUpdateCustomSlots: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
}

export const CustomSlotsManager: React.FC<CustomSlotsManagerProps> = ({
  dateStr,
  settings,
  windList,
  customSlotsMap,
  onUpdateCustomSlots,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [startInput, setStartInput] = useState<string>('14:00');
  const [endInput, setEndInput] = useState<string>('15:00');
  const [titleInput, setTitleInput] = useState<string>('Séance sur mesure');
  const [placesInput, setPlacesInput] = useState<number>(settings.cap || 1);

  const [y, m0, d] = dateStr.split('-').map(Number);
  const m = m0 - 1;

  const currentConfig = customSlotsMap[dateStr] || { replaceDefault: false, slots: [] };
  const customSlots = currentConfig.slots;
  const replaceDefault = currentConfig.replaceDefault;

  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startInput || !endInput) return;

    const newSlot: CustomSlot = {
      id: `cs_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      start: startInput,
      end: endInput,
      title: titleInput.trim() || 'Séance sur mesure',
      places: placesInput > 0 ? placesInput : 1,
    };

    const updated = [...customSlots, newSlot].sort((a, b) => a.start.localeCompare(b.start));
    onUpdateCustomSlots(dateStr, replaceDefault, updated);
  };

  const handleDeleteSlot = (id: string) => {
    const updated = customSlots.filter(s => s.id !== id);
    onUpdateCustomSlots(dateStr, replaceDefault, updated);
  };

  const handleToggleReplace = (checked: boolean) => {
    onUpdateCustomSlots(dateStr, checked, customSlots);
  };

  const handleClearAll = () => {
    if (window.confirm('Supprimer tous les créneaux sur mesure pour cette journée ?')) {
      onUpdateCustomSlots(dateStr, false, []);
    }
  };

  return (
    <div
      style={{
        marginTop: '12px',
        border: '1px dashed var(--ac)',
        borderRadius: '10px',
        padding: '12px',
        background: 'var(--cell)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem' }}>✏️</span>
          <div>
            <b
              style={{
                fontSize: '0.82rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Créneaux sur mesure ({customSlots.length})
            </b>
            <div style={{ fontSize: '0.68rem', color: 'var(--mu)' }}>
              {customSlots.length > 0
                ? replaceDefault
                  ? 'Remplace les créneaux automatiques pour ce jour'
                  : 'Complète les créneaux automatiques'
                : 'Personnaliser ou remplacer les créneaux de cette journée'}
            </div>
          </div>
        </div>

        <button
          type="button"
          style={{
            border: '1px solid var(--bd)',
            background: 'var(--card)',
            color: 'var(--tx)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.72rem',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {isOpen ? 'Masquer' : 'Gérer'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--bd)', paddingTop: '10px' }}>
          {/* Replace default slots checkbox */}
          <label className="ck" style={{ marginBottom: '10px' }}>
            <input
              type="checkbox"
              checked={replaceDefault}
              onChange={e => handleToggleReplace(e.target.checked)}
            />{' '}
            <b>Remplacer définitivement les créneaux automatiques</b> par ces créneaux sur mesure
          </label>

          {/* List of existing custom slots */}
          {customSlots.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: 'var(--mu)',
                  marginBottom: '6px',
                }}
              >
                Créneaux sur mesure actifs :
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {customSlots.map((cs) => {
                  const [sh, sm] = cs.start.split(':').map(Number);
                  const [eh, em] = cs.end.split(':').map(Number);
                  const a = toU(y, m, d, sh * 60 + sm);
                  const b = toU(y, m, d, eh * 60 + em);
                  const ok = sw(a, b, settings, windList);

                  return (
                    <div
                      key={cs.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'var(--card)',
                        borderRadius: '8px',
                        border: '1px solid var(--bd)',
                      }}
                    >
                      <div>
                        <b>
                          {cs.start} – {cs.end}
                        </b>{' '}
                        <span style={{ fontSize: '0.78rem', color: 'var(--mu)' }}>
                          · {cs.title} ({cs.places} {cs.places > 1 ? 'places' : 'place'})
                        </span>
                        <div style={{ fontSize: '0.68rem', marginTop: '2px' }}>
                          {ok === true ? (
                            <span style={{ color: 'var(--ok)', fontWeight: 700 }}>● Vent OK</span>
                          ) : ok === false ? (
                            <span style={{ color: 'var(--mid)', fontWeight: 700 }}>
                              ⚠ Vent hors plage
                            </span>
                          ) : (
                            <span style={{ color: 'var(--mu)' }}>Vent non vérifié</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteSlot(cs.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#c8402f',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          padding: '4px 6px',
                        }}
                        title="Supprimer ce créneau"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleClearAll}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--mu)',
                  fontSize: '0.68rem',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  marginTop: '6px',
                  padding: 0,
                }}
              >
                Rétablir les créneaux par défaut
              </button>
            </div>
          )}

          {/* Form to add a custom slot */}
          <form
            onSubmit={handleAddSlot}
            style={{
              background: 'var(--card)',
              borderRadius: '8px',
              padding: '10px',
              border: '1px solid var(--bd)',
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                marginBottom: '8px',
              }}
            >
              + Ajouter un créneau sur mesure
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: '8px',
                alignItems: 'end',
              }}
            >
              <label>
                Début
                <input
                  type="time"
                  required
                  value={startInput}
                  onChange={e => setStartInput(e.target.value)}
                  style={{
                    padding: '6px',
                    borderRadius: '6px',
                    border: '1px solid var(--bd)',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    font: 'inherit',
                  }}
                />
              </label>

              <label>
                Fin
                <input
                  type="time"
                  required
                  value={endInput}
                  onChange={e => setEndInput(e.target.value)}
                  style={{
                    padding: '6px',
                    borderRadius: '6px',
                    border: '1px solid var(--bd)',
                    background: 'var(--bg)',
                    color: 'var(--tx)',
                    font: 'inherit',
                  }}
                />
              </label>

              <label style={{ gridColumn: 'span 2' }}>
                Intitulé / Type
                <input
                  type="text"
                  value={titleInput}
                  placeholder="Séance club, Initiation..."
                  onChange={e => setTitleInput(e.target.value)}
                />
              </label>

              <label>
                Places
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={placesInput}
                  onChange={e => setPlacesInput(parseInt(e.target.value, 10) || 1)}
                />
              </label>

              <button
                type="submit"
                className="wbtn"
                style={{ padding: '8px 10px', height: '36px' }}
              >
                Ajouter
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
