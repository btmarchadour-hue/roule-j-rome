import React, { useState } from 'react';
import { AppSettings, CustomSlot, CustomSlotsMap, WindPoint } from '../types';
import { sw, toU } from '../utils/tides';

interface CustomSlotsManagerProps {
  dateStr: string;
  settings: AppSettings;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  onUpdateCustomSlots: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  defaultSlots?: { start: string; end: string; title?: string }[];
  isOpenControlled?: boolean;
  onToggleOpen?: () => void;
}

export const CustomSlotsManager: React.FC<CustomSlotsManagerProps> = ({
  dateStr,
  settings,
  windList,
  customSlotsMap,
  onUpdateCustomSlots,
  defaultSlots = [],
  isOpenControlled,
  onToggleOpen,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const isOpen = isOpenControlled !== undefined ? isOpenControlled : internalIsOpen;
  const toggleOpen = onToggleOpen || (() => setInternalIsOpen(!internalIsOpen));

  const [startInput, setStartInput] = useState<string>('14:00');
  const [endInput, setEndInput] = useState<string>('15:00');
  const [titleInput, setTitleInput] = useState<string>('Séance sur mesure');
  const [placesInput, setPlacesInput] = useState<number>(settings.cap || 1);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  const [y, m0, d] = dateStr.split('-').map(Number);

  const currentConfig = customSlotsMap[dateStr] || { replaceDefault: false, slots: [] };
  const customSlots = currentConfig.slots;
  const replaceDefault = currentConfig.replaceDefault;

  const handleSaveSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startInput || !endInput) return;

    if (editingSlotId) {
      // Mise à jour d'un créneau existant
      const updated = customSlots.map(s => {
        if (s.id === editingSlotId) {
          return {
            ...s,
            start: startInput,
            end: endInput,
            title: titleInput.trim() || 'Séance sur mesure',
            places: placesInput > 0 ? placesInput : 1,
          };
        }
        return s;
      }).sort((a, b) => a.start.localeCompare(b.start));

      onUpdateCustomSlots(dateStr, replaceDefault, updated);
      setEditingSlotId(null);
      setTitleInput('Séance sur mesure');
    } else {
      // Ajout d'un nouveau créneau
      const newSlot: CustomSlot = {
        id: `cs_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        start: startInput,
        end: endInput,
        title: titleInput.trim() || 'Séance sur mesure',
        places: placesInput > 0 ? placesInput : 1,
      };

      const updated = [...customSlots, newSlot].sort((a, b) => a.start.localeCompare(b.start));
      onUpdateCustomSlots(dateStr, replaceDefault, updated);
    }
  };

  const handleStartEdit = (cs: CustomSlot) => {
    setEditingSlotId(cs.id);
    setStartInput(cs.start);
    setEndInput(cs.end);
    setTitleInput(cs.title || 'Séance');
    setPlacesInput(cs.places || 1);
    if (!isOpen) toggleOpen();
  };

  const handleCancelEdit = () => {
    setEditingSlotId(null);
    setTitleInput('Séance sur mesure');
  };

  const handleDeleteSlot = (id: string) => {
    const updated = customSlots.filter(s => s.id !== id);
    onUpdateCustomSlots(dateStr, replaceDefault, updated);
    if (editingSlotId === id) setEditingSlotId(null);
  };

  const handleToggleReplace = (checked: boolean) => {
    onUpdateCustomSlots(dateStr, checked, customSlots);
  };

  const handleImportCalculatedSlots = () => {
    if (!defaultSlots || defaultSlots.length === 0) return;
    const imported: CustomSlot[] = defaultSlots.map((ds, idx) => ({
      id: `cs_imp_${Date.now()}_${idx}`,
      start: ds.start,
      end: ds.end,
      title: ds.title || `Séance ${idx + 1}`,
      places: settings.cap || 1,
    }));
    // Remplacer automatiquement les créneaux par défaut pour permettre modification totale
    onUpdateCustomSlots(dateStr, true, imported);
    if (!isOpen) toggleOpen();
  };

  const handleClearAll = () => {
    if (window.confirm('Rétablir les créneaux automatiques et effacer les modifications manuelles de ce jour ?')) {
      onUpdateCustomSlots(dateStr, false, []);
      setEditingSlotId(null);
    }
  };

  return (
    <div
      id="custom-slots-section"
      style={{
        marginTop: '14px',
        border: replaceDefault ? '2px solid #0284c7' : '1px dashed var(--ac, #ffc40d)',
        borderRadius: '10px',
        padding: '14px',
        background: replaceDefault ? '#f0f9ff' : 'var(--cell)',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          flexWrap: 'wrap',
          gap: '8px',
        }}
        onClick={toggleOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>✏️</span>
          <div>
            <b
              style={{
                fontSize: '0.85rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#0f172a',
              }}
            >
              Gestion manuelle des créneaux ({customSlots.length > 0 ? `${customSlots.length} sur mesure` : 'automatique'})
            </b>
            <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
              {customSlots.length > 0
                ? replaceDefault
                  ? '🔒 Créneaux manuels personnalisés (remplacent le calcul automatique)'
                  : '➕ Créneaux complémentaires ajoutés aux créneaux automatiques'
                : 'Redéfinir, décaler ou remplacer manuellement les créneaux de cette journée'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            style={{
              border: '1px solid var(--bd, #cbd5e1)',
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: '6px',
              padding: '5px 10px',
              fontSize: '0.74rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {isOpen ? 'Masquer ▲' : 'Gérer manuellement ▼'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div style={{ marginTop: '14px', borderTop: '1px solid #cbd5e1', paddingTop: '12px' }}>
          {/* Quick action: Importer les créneaux automatiques pour modification totale */}
          {defaultSlots.length > 0 && (!replaceDefault || customSlots.length === 0) && (
            <div
              style={{
                background: '#ffffff',
                border: '1.5px solid #0284c7',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#0369a1' }}>
                  💡 Souplesse totale : modifier les horaires calculés
                </div>
                <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
                  Copie les {defaultSlots.length} créneau{defaultSlots.length > 1 ? 'x' : ''} automatique{defaultSlots.length > 1 ? 's' : ''} dans la liste manuelle pour pouvoir décaler l'heure de départ, changer la durée ou en supprimer un.
                </div>
              </div>
              <button
                type="button"
                onClick={handleImportCalculatedSlots}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontWeight: 800,
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
                }}
              >
                📋 Reprendre les {defaultSlots.length} créneaux automatiques
              </button>
            </div>
          )}

          {/* Replace default slots checkbox & reset button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <label className="ck" style={{ margin: 0, fontSize: '0.76rem', color: '#334155' }}>
              <input
                type="checkbox"
                checked={replaceDefault}
                onChange={e => handleToggleReplace(e.target.checked)}
              />{' '}
              <strong>Remplacer totalement les créneaux automatiques</strong> par cette sélection manuelle
            </label>

            {customSlots.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                style={{
                  background: 'transparent',
                  border: '1px solid #fca5a5',
                  color: '#dc2626',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ↩ Rétablir créneaux automatiques
              </button>
            )}
          </div>

          {/* List of existing custom slots */}
          {customSlots.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: '#475569',
                  marginBottom: '6px',
                }}
              >
                Créneaux manuels définis ({customSlots.length}) :
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {customSlots.map((cs) => {
                  const [sh, sm] = cs.start.split(':').map(Number);
                  const [eh, em] = cs.end.split(':').map(Number);
                  const a = toU(y, m0 - 1, d, sh * 60 + sm);
                  const b = toU(y, m0 - 1, d, eh * 60 + em);
                  const ok = sw(a, b, settings, windList);
                  const isEditing = editingSlotId === cs.id;

                  return (
                    <div
                      key={cs.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: isEditing ? '#eff6ff' : '#ffffff',
                        borderRadius: '8px',
                        border: isEditing ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      }}
                    >
                      <div>
                        <b style={{ color: '#0f172a', fontSize: '0.82rem' }}>
                          {cs.start} – {cs.end}
                        </b>{' '}
                        <span style={{ fontSize: '0.76rem', color: '#475569' }}>
                          · {cs.title} ({cs.places} {cs.places > 1 ? 'places' : 'place'})
                        </span>
                        <div style={{ fontSize: '0.68rem', marginTop: '2px' }}>
                          {ok === true ? (
                            <span style={{ color: '#16a34a', fontWeight: 800 }}>● Vent OK</span>
                          ) : ok === false ? (
                            <span style={{ color: '#dc2626', fontWeight: 800 }}>● Vent hors limites</span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Vent non disponible</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(cs)}
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            color: '#334155',
                            cursor: 'pointer',
                          }}
                        >
                          ✏️ Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(cs.id)}
                          style={{
                            background: '#fee2e2',
                            border: '1px solid #fca5a5',
                            color: '#b91c1c',
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '0.70rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ✕ Supprimer
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form to add or edit a slot */}
          <form
            onSubmit={handleSaveSlot}
            style={{
              background: '#ffffff',
              padding: '12px',
              borderRadius: '8px',
              border: editingSlotId ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
            }}
          >
            <div
              style={{
                fontSize: '0.74rem',
                fontWeight: 800,
                color: editingSlotId ? '#0284c7' : '#0f172a',
                marginBottom: '8px',
              }}
            >
              {editingSlotId ? '✏️ Modifier l’horaire du créneau :' : '+ Ajouter un créneau sur mesure :'}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                marginBottom: '10px',
              }}
            >
              <label style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                Heure de début
                <input
                  type="time"
                  value={startInput}
                  onChange={e => setStartInput(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                  required
                />
              </label>

              <label style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                Heure de fin
                <input
                  type="time"
                  value={endInput}
                  onChange={e => setEndInput(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                  required
                />
              </label>

              <label style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                Intitulé / Type
                <input
                  type="text"
                  placeholder="Ex: Groupe débutant"
                  value={titleInput}
                  onChange={e => setTitleInput(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                />
              </label>

              <label style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                Places (chars)
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={placesInput}
                  onChange={e => setPlacesInput(parseInt(e.target.value, 10) || 1)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="submit"
                style={{
                  background: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 14px',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
                }}
              >
                {editingSlotId ? '✓ Valider la modification' : '+ Ajouter ce créneau'}
              </button>

              {editingSlotId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  style={{
                    background: 'transparent',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '7px 12px',
                    fontSize: '0.74rem',
                    color: '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
