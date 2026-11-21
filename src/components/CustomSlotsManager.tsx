import React, { useState } from 'react';
import { AppSettings, CustomSlot, CustomSlotsMap, WindPoint } from '../types';
import { sw, toU } from '../utils/tides';

interface ProtectedSlotReason {
  start: string;
  end: string;
  reason: string;
}

export interface SlotActivityConflict {
  start: string;
  end: string;
  chars: number;
  hasRex: boolean;
  hasC2Decision: boolean;
  isClassic: boolean;
  label?: string;
}

export interface CreateCustomSlotOptions {
  replaceDefault?: boolean;
  dropAdaptedClassics?: boolean;
}

interface CustomSlotsManagerProps {
  dateStr: string;
  settings: AppSettings;
  windList: WindPoint[];
  customSlotsMap: CustomSlotsMap;
  onUpdateCustomSlots: (dateStr: string, replaceDefault: boolean, slots: CustomSlot[]) => void;
  onCreateAndPublishSlot?: (
    dateStr: string,
    slot: CustomSlot,
    options?: CreateCustomSlotOptions
  ) => void;
  defaultSlots?: { start: string; end: string; title?: string }[];
  isOpenControlled?: boolean;
  onToggleOpen?: () => void;
  isReadOnly?: boolean;
  protectedSlotReasons?: ProtectedSlotReason[];
  slotActivityList?: SlotActivityConflict[];
  dayResetLockReason?: string | null;
}

export const CustomSlotsManager: React.FC<CustomSlotsManagerProps> = ({
  dateStr,
  settings,
  windList,
  customSlotsMap,
  onUpdateCustomSlots: rawOnUpdateCustomSlots,
  onCreateAndPublishSlot,
  defaultSlots = [],
  isOpenControlled,
  onToggleOpen,
  isReadOnly = false,
  protectedSlotReasons = [],
  slotActivityList = [],
  dayResetLockReason = null,
}) => {
  const onUpdateCustomSlots = (ds: string, rep: boolean, slots: CustomSlot[]) => {
    if (isReadOnly) return;
    rawOnUpdateCustomSlots(ds, rep, slots);
  };
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const isOpen = isOpenControlled !== undefined ? isOpenControlled : internalIsOpen;
  const toggleOpen = onToggleOpen || (() => setInternalIsOpen(!internalIsOpen));

  const [startInput, setStartInput] = useState<string>('14:00');
  const [endInput, setEndInput] = useState<string>('15:00');
  const [titleInput, setTitleInput] = useState<string>('Séance sur mesure');
  const [placesInput, setPlacesInput] = useState<number>(settings.cap || 1);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const [y, m0, d] = dateStr.split('-').map(Number);

  const currentConfig = customSlotsMap[dateStr] || { replaceDefault: false, slots: [] };
  const customSlots = currentConfig.slots;
  const replaceDefault = currentConfig.replaceDefault;

  const normHHMM = (v: string) => v.trim().replace('h', ':');
  const fmtHHhMM = (v: string) => normHHMM(v).replace(':', 'h');
  const toMinHHMM = (v: string) => {
    const [hh, mm] = normHHMM(v).split(':').map(Number);
    return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  };
  const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && aEnd > bStart;

  const isAdaptedClassicSlot = (cs: CustomSlot) =>
    Boolean(cs.isAdapted) || cs.id.startsWith('c1-');

  const activeClassicConflicts = slotActivityList.filter(
    s => s.isClassic && (s.chars > 0 || s.hasRex || s.hasC2Decision)
  );

  const formatConflictItem = (c: SlotActivityConflict) => {
    const parts: string[] = [];
    if (c.chars > 0) parts.push(`${c.chars} char${c.chars > 1 ? 's' : ''} inscrit${c.chars > 1 ? 's' : ''}`);
    if (c.hasRex) parts.push('REX enregistré');
    if (!c.chars && !c.hasRex && c.hasC2Decision) parts.push('décision Cycle 2 active');
    return `${fmtHHhMM(c.start)}–${fmtHHhMM(c.end)} (${parts.join(', ')})`;
  };

  const getSlotLockReason = (cs: CustomSlot): string | null => {
    const prot = protectedSlotReasons.find(
      p => normHHMM(p.start) === normHHMM(cs.start) && normHHMM(p.end) === normHHMM(cs.end)
    );
    if (prot) return prot.reason;
    const [sh, sm] = normHHMM(cs.start).split(':').map(Number);
    const startUtcMin = toU(y, m0 - 1, d, sh * 60 + sm);
    if (startUtcMin - Date.now() / 60000 < 48 * 60) {
      return '< 48h avant début';
    }
    return null;
  };
  const effectiveDayResetLock =
    dayResetLockReason ||
    (customSlots.some(cs => getSlotLockReason(cs) !== null)
      ? 'au moins un créneau est verrouillé (< 48h ou avec activité/inscrits)'
      : null);

  /**
   * Validation commune anti-chevauchement & anti-corruption pour toute création/modif sur mesure.
   * Retourne soit une erreur bloquante explicite, soit le mode de remplacement propre des créneaux classiques.
   */
  const validateCandidateSlot = (
    candStart: string,
    candEnd: string,
    excludeId: string | null
  ): {
    error: string | null;
    shouldReplaceDefault: boolean;
    dropAdaptedClassics: boolean;
    notice: string | null;
  } => {
    const sMin = toMinHHMM(candStart);
    const eMin = toMinHHMM(candEnd);
    if (eMin <= sMin) {
      return {
        error: 'L’heure de fin doit être postérieure à l’heure de début.',
        shouldReplaceDefault: replaceDefault,
        dropAdaptedClassics: false,
        notice: null,
      };
    }

    // 1. Vérifier tout chevauchement avec un autre créneau sur mesure déjà défini
    const trueCustomOthers = customSlots.filter(
      cs => cs.id !== excludeId && !isAdaptedClassicSlot(cs)
    );
    const overlappingCustom = trueCustomOthers.find(cs =>
      rangesOverlap(sMin, eMin, toMinHHMM(cs.start), toMinHHMM(cs.end))
    );
    if (overlappingCustom) {
      return {
        error: `Chevauchement interdit avec le créneau sur mesure ${fmtHHhMM(overlappingCustom.start)} – ${fmtHHhMM(overlappingCustom.end)}. Modifiez ou supprimez d’abord ce créneau.`,
        shouldReplaceDefault: replaceDefault,
        dropAdaptedClassics: false,
        notice: null,
      };
    }

    // 2. Vérifier tout chevauchement avec un créneau déjà engagé (inscrits / REX / Cycle 2)
    const overlappingBusy = slotActivityList.filter(act => {
      if (act.chars <= 0 && !act.hasRex && !act.hasC2Decision) return false;
      if (excludeId) {
        const edited = customSlots.find(cs => cs.id === excludeId);
        if (
          edited &&
          normHHMM(edited.start) === normHHMM(act.start) &&
          normHHMM(edited.end) === normHHMM(act.end)
        ) {
          return false;
        }
      }
      return rangesOverlap(sMin, eMin, toMinHHMM(act.start), toMinHHMM(act.end));
    });
    if (overlappingBusy.length > 0) {
      return {
        error: `Incohérence détectée : cet horaire chevauche un créneau ayant déjà des inscrits ou un bilan (${overlappingBusy.map(formatConflictItem).join(' ; ')}). Déplacez ou annulez d’abord ces inscriptions dans Cycle 2 pour ne pas créer de doublon ni biaiser les statistiques.`,
        shouldReplaceDefault: replaceDefault,
        dropAdaptedClassics: false,
        notice: null,
      };
    }

    // 3. Vérifier si des créneaux classiques (auto ou adaptés C1) coexistent et doivent être remplacés proprement
    const hasAdaptedClassics = customSlots.some(
      cs => cs.id !== excludeId && isAdaptedClassicSlot(cs)
    );
    const overlapsDefaultClassic =
      !replaceDefault &&
      defaultSlots.some(ds =>
        rangesOverlap(sMin, eMin, toMinHHMM(ds.start), toMinHHMM(ds.end))
      );
    const overlapsAdaptedClassic = customSlots.some(
      cs =>
        cs.id !== excludeId &&
        isAdaptedClassicSlot(cs) &&
        rangesOverlap(sMin, eMin, toMinHHMM(cs.start), toMinHHMM(cs.end))
    );

    if (overlapsDefaultClassic || overlapsAdaptedClassic || (!replaceDefault && defaultSlots.length > 0 && !excludeId)) {
      // Dès qu'on crée un créneau sur mesure sur une journée avec créneaux classiques,
      // on impose le remplacement propre des créneaux classiques (pour éviter tout doublon/chevauchement
      // et ne pas laisser des créneaux classiques fantômes biaiser les statistiques).
      if (activeClassicConflicts.length > 0) {
        return {
          error: `Impossible de basculer en mode Sur mesure et supprimer les créneaux classiques : certains ont encore des inscrits ou un REX (${activeClassicConflicts.map(formatConflictItem).join(' ; ')}). Traitez d’abord ces créneaux dans Cycle 2.`,
          shouldReplaceDefault: replaceDefault,
          dropAdaptedClassics: false,
          notice: null,
        };
      }
      return {
        error: null,
        shouldReplaceDefault: true,
        dropAdaptedClassics: hasAdaptedClassics,
        notice:
          'Les créneaux classiques (sans inscrit) ont été remplacés proprement par vos créneaux sur mesure pour éviter tout chevauchement et préserver la fiabilité des statistiques.',
      };
    }

    return {
      error: null,
      shouldReplaceDefault: replaceDefault,
      dropAdaptedClassics: false,
      notice: null,
    };
  };

  const handleSaveSlot = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!startInput || !endInput) return;

    const check = validateCandidateSlot(startInput, endInput, editingSlotId);
    if (check.error) {
      setFormError(check.error);
      return;
    }

    const baseList = check.dropAdaptedClassics
      ? customSlots.filter(cs => !isAdaptedClassicSlot(cs))
      : customSlots;

    if (editingSlotId) {
      const targetSlot = customSlots.find(s => s.id === editingSlotId);
      if (targetSlot && getSlotLockReason(targetSlot)) {
        setEditingSlotId(null);
        return;
      }
      const updated = baseList.map(s => {
        if (s.id === editingSlotId) {
          return {
            ...s,
            start: startInput,
            end: endInput,
            title: titleInput.trim() || 'Séance sur mesure',
            places: placesInput > 0 ? placesInput : 1,
            isAdapted: false,
          };
        }
        return s;
      }).sort((a, b) => a.start.localeCompare(b.start));

      onUpdateCustomSlots(dateStr, check.shouldReplaceDefault, updated);
      setEditingSlotId(null);
      setTitleInput('Séance sur mesure');
      if (check.notice) setFormNotice(check.notice);
    } else {
      const newSlot: CustomSlot = {
        id: `cs_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        start: startInput,
        end: endInput,
        title: titleInput.trim() || 'Séance sur mesure',
        places: placesInput > 0 ? placesInput : 1,
        isAdapted: false,
      };

      const updated = [...baseList, newSlot].sort((a, b) => a.start.localeCompare(b.start));
      onUpdateCustomSlots(dateStr, check.shouldReplaceDefault, updated);
      if (check.notice) setFormNotice(check.notice);
    }
  };

  const handleStartEdit = (cs: CustomSlot) => {
    if (getSlotLockReason(cs)) return;
    setFormError(null);
    setFormNotice(null);
    setEditingSlotId(cs.id);
    setStartInput(normHHMM(cs.start));
    setEndInput(normHHMM(cs.end));
    setTitleInput(cs.title || 'Séance');
    setPlacesInput(cs.places || 1);
    if (!isOpen) toggleOpen();
  };

  const handleCancelEdit = () => {
    setFormError(null);
    setEditingSlotId(null);
    setTitleInput('Séance sur mesure');
  };

  const handleDeleteSlot = (id: string) => {
    const target = customSlots.find(s => s.id === id);
    if (target && getSlotLockReason(target)) return;
    const updated = customSlots.filter(s => s.id !== id);
    onUpdateCustomSlots(dateStr, replaceDefault, updated);
    if (editingSlotId === id) setEditingSlotId(null);
  };

  const handleToggleReplace = (checked: boolean) => {
    setFormError(null);
    setFormNotice(null);
    if (checked && activeClassicConflicts.length > 0) {
      setFormError(
        `Impossible de supprimer les créneaux classiques : certains ont déjà des inscrits ou un REX (${activeClassicConflicts.map(formatConflictItem).join(' ; ')}). Traitez-les d’abord dans Cycle 2.`
      );
      return;
    }
    if (effectiveDayResetLock) return;
    onUpdateCustomSlots(dateStr, checked, customSlots);
  };

  const handleImportCalculatedSlots = () => {
    setFormError(null);
    setFormNotice(null);
    if (activeClassicConflicts.length > 0) {
      setFormError(
        `Action bloquée : des créneaux classiques ont déjà des inscrits ou un REX (${activeClassicConflicts.map(formatConflictItem).join(' ; ')}).`
      );
      return;
    }
    if (effectiveDayResetLock) return;
    if (!defaultSlots || defaultSlots.length === 0) return;
    const imported: CustomSlot[] = defaultSlots.map((ds, idx) => ({
      id: `cs_imp_${Date.now()}_${idx}`,
      start: normHHMM(ds.start),
      end: normHHMM(ds.end),
      title: ds.title || `Séance ${idx + 1}`,
      places: settings.cap || 1,
    }));
    onUpdateCustomSlots(dateStr, true, imported);
    if (!isOpen) toggleOpen();
  };

  const handleClearAll = () => {
    if (effectiveDayResetLock) return;
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
              {(() => {
                const trueCustomCount = customSlots.filter(
                  cs => !cs.isAdapted && !cs.id.startsWith('c1-')
                ).length;
                const summaryLabel =
                  customSlots.length === 0
                    ? 'automatique'
                    : trueCustomCount > 0
                    ? `${trueCustomCount} sur mesure`
                    : `${customSlots.length} horaire${customSlots.length > 1 ? 's' : ''} géré${customSlots.length > 1 ? 's' : ''}`;
                return `Créneaux sur mesure & modification manuelle (${summaryLabel})`;
              })()}
            </b>
            <div style={{ fontSize: '0.70rem', color: '#64748b' }}>
              {customSlots.length > 0
                ? replaceDefault
                  ? customSlots.some(cs => !cs.isAdapted && !cs.id.startsWith('c1-'))
                    ? '🔒 Créneaux manuels personnalisés (remplacent le calcul automatique)'
                    : '🕒 Horaires adaptés en Cycle 1 depuis les créneaux de marée'
                  : '➕ Créneaux complémentaires ajoutés aux créneaux automatiques'
                : 'Créer un créneau sur mesure ou redéfinir manuellement les créneaux de cette journée'}
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
            {isOpen ? 'Masquer ▲' : 'Créer / modifier ▼'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div style={{ marginTop: '14px', borderTop: '1px solid #cbd5e1', paddingTop: '12px' }}>
          {/* Garde-fou explicite : créneaux classiques déjà engagés (inscrits / REX) vs remplacement propre */}
          {activeClassicConflicts.length > 0 ? (
            <div
              style={{
                background: '#fef2f2',
                border: '1.5px solid #fca5a5',
                borderRadius: '8px',
                padding: '9px 12px',
                marginBottom: '12px',
                color: '#991b1b',
                fontSize: '0.73rem',
                lineHeight: 1.4,
              }}
            >
              <strong>⚠️ Incohérence à traiter avant remplacement par du sur mesure :</strong>
              <div style={{ marginTop: '3px' }}>
                Créneau(x) classique(s) déjà engagé(s) :{' '}
                <strong>{activeClassicConflicts.map(formatConflictItem).join(' · ')}</strong>.
                <br />
                Déplacez ou annulez d’abord ces inscriptions dans Cycle 2 afin d’éviter tout doublon et ne pas biaiser les statistiques.
              </div>
            </div>
          ) : (
            (!replaceDefault || customSlots.some(isAdaptedClassicSlot)) &&
            defaultSlots.length > 0 && (
              <div
                style={{
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  marginBottom: '12px',
                  color: '#0369a1',
                  fontSize: '0.72rem',
                  lineHeight: 1.4,
                }}
              >
                <strong>ℹ️ Règle anti-doublon :</strong> ajouter un créneau sur mesure supprime automatiquement les créneaux classiques (sans inscrit) pour éviter tout chevauchement et garder des statistiques exactes.
              </div>
            )
          )}

          {/* Quick action: Importer les créneaux automatiques pour modification totale */}
          {defaultSlots.length > 0 && (!replaceDefault || customSlots.length === 0) && !effectiveDayResetLock && (
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
            <label
              className="ck"
              style={{
                margin: 0,
                fontSize: '0.76rem',
                color: effectiveDayResetLock ? '#94a3b8' : '#334155',
                cursor: effectiveDayResetLock ? 'not-allowed' : 'pointer',
              }}
              title={effectiveDayResetLock ? `Verrouillé : ${effectiveDayResetLock}` : undefined}
            >
              <input
                type="checkbox"
                checked={replaceDefault}
                disabled={Boolean(effectiveDayResetLock)}
                onChange={e => handleToggleReplace(e.target.checked)}
              />{' '}
              <strong>Remplacer totalement les créneaux automatiques</strong> par cette sélection manuelle
            </label>

            {customSlots.length > 0 && (
              effectiveDayResetLock ? (
                <span
                  style={{
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    color: '#64748b',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '3px 8px',
                  }}
                  title={`Rétablissement verrouillé : ${effectiveDayResetLock}`}
                >
                  🔒 Rétablissement bloqué ({effectiveDayResetLock})
                </span>
              ) : (
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
              )
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

                      {!isReadOnly && (() => {
                        const rowLockReason = getSlotLockReason(cs);
                        if (rowLockReason) {
                          return (
                            <span
                              style={{
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                borderRadius: '5px',
                                padding: '3px 8px',
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                color: '#64748b',
                              }}
                              title={`Modification et suppression verrouillées (${rowLockReason})`}
                            >
                              🔒 {rowLockReason}
                            </span>
                          );
                        }
                        return (
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
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form to add or edit a slot or read-only indicator */}
          {isReadOnly ? (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#92400e',
                fontSize: '0.74rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🔒</span>
              <span>Mode Contrôle actif (Benoît) : La création et la modification de créneaux sur mesure sont verrouillées en lecture seule.</span>
            </div>
          ) : (
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

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {formError && (
                <div
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: '6px',
                    background: '#fef2f2',
                    border: '1.5px solid #fca5a5',
                    color: '#b91c1c',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    lineHeight: 1.4,
                  }}
                >
                  ⛔ {formError}
                </div>
              )}
              {formNotice && (
                <div
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    borderRadius: '6px',
                    background: '#f0f9ff',
                    border: '1px solid #7dd3fc',
                    color: '#0369a1',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    lineHeight: 1.4,
                  }}
                >
                  ✅ {formNotice}
                </div>
              )}
              {!editingSlotId && onCreateAndPublishSlot && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setFormNotice(null);
                    if (!startInput || !endInput) return;
                    const check = validateCandidateSlot(startInput, endInput, null);
                    if (check.error) {
                      setFormError(check.error);
                      return;
                    }
                    const newSlot: CustomSlot = {
                      id: `cs_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                      start: startInput,
                      end: endInput,
                      title: titleInput.trim() || 'Séance sur mesure',
                      places: placesInput > 0 ? placesInput : 1,
                      isAdapted: false,
                    };
                    onCreateAndPublishSlot(dateStr, newSlot, {
                      replaceDefault: check.shouldReplaceDefault,
                      dropAdaptedClassics: check.dropAdaptedClassics,
                    });
                    setTitleInput('Séance sur mesure');
                    if (check.notice) setFormNotice(check.notice);
                  }}
                  style={{
                    background: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '7px 14px',
                    fontWeight: 800,
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(22, 163, 74, 0.25)',
                  }}
                  title="Créer ce créneau sur mesure et le publier directement dans Cycle 2"
                >
                  ⚡ Créer &amp; publier directement (C2)
                </button>
              )}

              <button
                type="submit"
                style={{
                  background: !editingSlotId && onCreateAndPublishSlot ? '#ffffff' : '#0284c7',
                  color: !editingSlotId && onCreateAndPublishSlot ? '#0369a1' : '#fff',
                  border: !editingSlotId && onCreateAndPublishSlot ? '1.5px solid #0284c7' : 'none',
                  borderRadius: '6px',
                  padding: '7px 14px',
                  fontWeight: 800,
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  boxShadow: !editingSlotId && onCreateAndPublishSlot ? 'none' : '0 2px 4px rgba(2, 132, 199, 0.25)',
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
          )}
        </div>
      )}
    </div>
  );
};
