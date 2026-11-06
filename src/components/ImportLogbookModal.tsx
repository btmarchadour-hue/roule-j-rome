import React, { useState, useRef } from 'react';
import { SlotObservation } from '../types';
import { CANCELLATION_REASONS_INFO, bulkUpsertObservations } from '../utils/statisticsEngine';
import {
  downloadExcelLogbookTemplate,
  parseLogbookFile,
  ImportResult,
  ParsedLogbookRow,
} from '../utils/excelImportExport';
import { batchSaveObservationsToFirestore } from '../utils/firebaseSync';

interface ImportLogbookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (updatedObservations: SlotObservation[]) => void;
}

export const ImportLogbookModal: React.FC<ImportLogbookModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'valid' | 'partial' | 'errors'>('all');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    setSelectedFile(file);
    setParsing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setParseResult(null);

    try {
      const result = await parseLogbookFile(file);
      setParseResult(result);
      if (result.validCount === 0) {
        setErrorMessage('Aucune ligne exploitable n a pu être lue dans ce fichier.');
      }
    } catch (err: any) {
      console.error('Erreur lecture carnet:', err);
      setErrorMessage(err.message || 'Impossible de lire le fichier.');
    } finally {
      setParsing(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParseResult(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmImport = async () => {
    if (!parseResult) return;

    const validObs = parseResult.items
      .filter(item => item.isValid && item.observation)
      .map(item => item.observation as SlotObservation);

    if (validObs.length === 0) {
      alert('Aucune séance valide à importer.');
      return;
    }

    setImporting(true);
    setImportProgress(`Envoi de ${validObs.length} séances vers Firebase Firestore...`);

    try {
      // 1. Sauvegarde Cloud Firestore par lots
      await batchSaveObservationsToFirestore(validObs);

      // 2. Mise à jour de la mémoire locale
      const updated = bulkUpsertObservations(validObs);

      setSuccessMessage(
        `🎉 ${validObs.length} séances ont été importées et synchronisées dans le Cloud avec succès !`
      );
      onImportSuccess(updated);
    } catch (err: any) {
      console.error('Erreur import:', err);
      setErrorMessage(
        `Erreur lors de l enregistrement dans le Cloud : ${err.message || 'Vérifiez la connexion réseau.'}`
      );
    } finally {
      setImporting(false);
    }
  };

  // Filtrage des lignes pour le tableau de prévisualisation
  const filteredRows = (parseResult?.items || []).filter(item => {
    if (activeTab === 'valid') return item.isValid && !item.isPartial;
    if (activeTab === 'partial') return item.isValid && item.isPartial;
    if (activeTab === 'errors') return !item.isValid;
    return true;
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid #cbd5e1',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER MODAL */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Char à Voile du Bout du Monde · Lestrevet
            </div>
            <h3 style={{ margin: '3px 0 0', fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
              📥 Importer un Carnet ou Historique REX
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Import groupé depuis Excel (.xlsx, .xls) ou CSV. Prise en charge intégrale des données partielles ou incomplètes.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '8px',
              width: '34px',
              height: '34px',
              cursor: 'pointer',
              fontSize: '1.1rem',
              color: '#64748b',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {/* CONTENU SCROLLABLE */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* BANDEAU MODÈLE EXCEL TYPE */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0369a1' }}>
                📄 Vous n avez pas encore le fichier type ?
              </div>
              <div style={{ fontSize: '0.78rem', color: '#0c4a6e', marginTop: '2px' }}>
                Téléchargez notre modèle Excel pré-rempli avec des exemples concrets pour la plage de Lestrevet.
              </div>
            </div>

            <button
              type="button"
              onClick={downloadExcelLogbookTemplate}
              style={{
                padding: '8px 14px',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
              }}
            >
              <span>📥</span>
              <span>Télécharger Modèle Excel Vierge</span>
            </button>
          </div>

          {/* ZONE DE DRAG & DROP / CHOIX DU FICHIER */}
          {!parseResult && !parsing && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: dragActive ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
                backgroundColor: dragActive ? '#f0f9ff' : '#f8fafc',
                borderRadius: '12px',
                padding: '36px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
              <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>📑</div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
                Glissez votre fichier ici ou cliquez pour parcourir
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                Formats acceptés : <strong>.xlsx, .xls</strong> (Excel) ou <strong>.csv</strong>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '8px' }}>
                Les dates françaises (JJ/MM/AAAA) ou ISO (AAAA-MM-JJ) sont automatiquement reconnues.
              </div>
            </div>
          )}

          {/* ÉTAT DE CHARGEMENT / ANALYSE */}
          {parsing && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '10px' }}>⏳</div>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>Analyse et décodage du classeur en cours...</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                Vérification des colonnes, normalisation des motifs et détection des données partielles.
              </div>
            </div>
          )}

          {/* RÉSULTAT DU PARSING & PRÉVISUALISATION */}
          {parseResult && !parsing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* FICHIER & STATS */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '10px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.88rem' }}>
                    📎 {selectedFile?.name}
                  </span>
                  <span style={{ marginLeft: '10px', fontSize: '0.78rem', color: '#64748b' }}>
                    ({parseResult.totalRows} lignes détectées)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#dc2626',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Changer de fichier
                </button>
              </div>

              {/* BADGES RÉSUMÉ */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#047857', textTransform: 'uppercase' }}>
                    ✓ Séances Valides
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#065f46', marginTop: '2px' }}>
                    {parseResult.validCount}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#059669' }}>
                    Prêtes à enrichir les statistiques
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#fefce8',
                    border: '1px solid #fde047',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#a16207', textTransform: 'uppercase' }}>
                    ⚠️ Données Partielles Tolérées
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#854d0e', marginTop: '2px' }}>
                    {parseResult.partialCount}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#a16207' }}>
                    Infos incomplètes mais intégrables
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: parseResult.errorCount > 0 ? '#fef2f2' : '#f8fafc',
                    border: `1px solid ${parseResult.errorCount > 0 ? '#fecaca' : '#e2e8f0'}`,
                    borderRadius: '8px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: parseResult.errorCount > 0 ? '#b91c1c' : '#64748b',
                      textTransform: 'uppercase',
                    }}
                  >
                    {parseResult.errorCount > 0 ? '❌ Lignes Invalides' : '✓ Aucune Erreur'}
                  </div>
                  <div
                    style={{
                      fontSize: '1.35rem',
                      fontWeight: 900,
                      color: parseResult.errorCount > 0 ? '#991b1b' : '#334155',
                      marginTop: '2px',
                    }}
                  >
                    {parseResult.errorCount}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: parseResult.errorCount > 0 ? '#dc2626' : '#94a3b8' }}>
                    {parseResult.errorCount > 0 ? 'Date manquante ou illisible' : 'Structure 100% propre'}
                  </div>
                </div>
              </div>

              {/* RAPPEL PÉDAGOGIQUE SUR LES DONNÉES INCOMPLÈTES */}
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '0.76rem',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>💡</span>
                <div>
                  <strong>Pourquoi les données partielles sont très précieuses :</strong> Même si Jérôme n a noté que la date et si la séance a eu lieu (sans renseigner le vent ni les participants), l outil comptabilise tout de même la séance pour calculer le taux de concrétisation et les motifs de non-réalisation !
                </div>
              </div>

              {/* ONGLETS DE FILTRAGE DU TABLEAU */}
              <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: activeTab === 'all' ? 800 : 600,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'all' ? '#0f172a' : '#f1f5f9',
                    color: activeTab === 'all' ? '#ffffff' : '#64748b',
                  }}
                >
                  Toutes les lignes ({parseResult.items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('valid')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: activeTab === 'valid' ? 800 : 600,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'valid' ? '#059669' : '#f1f5f9',
                    color: activeTab === 'valid' ? '#ffffff' : '#64748b',
                  }}
                >
                  Complètes ({parseResult.validCount - parseResult.partialCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('partial')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: activeTab === 'partial' ? 800 : 600,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'partial' ? '#d97706' : '#f1f5f9',
                    color: activeTab === 'partial' ? '#ffffff' : '#64748b',
                  }}
                >
                  Partielles tolérées ({parseResult.partialCount})
                </button>
                {parseResult.errorCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('errors')}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      fontWeight: activeTab === 'errors' ? 800 : 600,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                      backgroundColor: activeTab === 'errors' ? '#dc2626' : '#f1f5f9',
                      color: activeTab === 'errors' ? '#ffffff' : '#64748b',
                    }}
                  >
                    Erreurs ({parseResult.errorCount})
                  </button>
                )}
              </div>

              {/* TABLEAU DE PRÉVISUALISATION */}
              <div
                style={{
                  maxHeight: '260px',
                  overflowY: 'auto',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Ligne</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Date</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Horaire</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Statut & Motif</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Pilotes</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Moniteur</th>
                      <th style={{ padding: '8px 10px', color: '#64748b' }}>Météo / Remarques</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(item => {
                      const obs = item.observation;
                      const isRealized = obs?.status === 'realized';
                      const reasonInfo = obs?.cancellationReason
                        ? CANCELLATION_REASONS_INFO[obs.cancellationReason]
                        : null;

                      return (
                        <tr
                          key={item.rowNumber}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: !item.isValid ? '#fef2f2' : item.isPartial ? '#fffdf0' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#64748b' }}>
                            #{item.rowNumber}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                            {obs ? obs.ds : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#334155', whiteSpace: 'nowrap' }}>
                            {obs ? `${obs.slotStart} → ${obs.slotEnd}` : '-'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {!item.isValid ? (
                              <span style={{ color: '#dc2626', fontWeight: 700 }}>❌ {item.error}</span>
                            ) : isRealized ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 6px',
                                  backgroundColor: '#dcfce7',
                                  color: '#166534',
                                  borderRadius: '4px',
                                  fontWeight: 800,
                                }}
                              >
                                ✓ Réalisée
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 6px',
                                  backgroundColor: '#fee2e2',
                                  color: '#991b1b',
                                  borderRadius: '4px',
                                  fontWeight: 800,
                                }}
                              >
                                ⛔ {reasonInfo ? reasonInfo.shortLabel : 'Annulée'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                            {obs?.participantsCount !== undefined ? `${obs.participantsCount} p.` : <span style={{ color: '#94a3b8' }}>-</span>}
                            {obs?.monoCount !== undefined && obs?.biCount !== undefined && (
                              <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '4px' }}>
                                ({obs.monoCount}M / {obs.biCount}B)
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569' }}>
                            {obs?.author || 'Jérôme'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#64748b' }}>
                            {obs?.observedWindKts ? `${obs.observedWindKts} nds ${obs.observedWindDir || ''} ` : ''}
                            {obs?.notes ? `"${obs.notes}"` : ''}
                            {item.warnings.length > 0 && (
                              <div style={{ color: '#d97706', fontSize: '0.68rem', marginTop: '2px' }}>
                                ⚠️ {item.warnings.join(' • ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MESSAGES D ERREUR OU SUCCÈS */}
          {errorMessage && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              style={{
                padding: '14px 18px',
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                color: '#065f46',
                borderRadius: '8px',
                fontSize: '0.86rem',
                fontWeight: 800,
              }}
            >
              {successMessage}
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {parseResult ? (
              <span>
                <strong>{parseResult.validCount}</strong> séance(s) prête(s) à être synchronisées.
              </span>
            ) : (
              <span>Glissez un fichier Excel ou CSV pour commencer.</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                color: '#475569',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Fermer
            </button>

            {parseResult && parseResult.validCount > 0 && !successMessage && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={importing}
                style={{
                  padding: '9px 18px',
                  backgroundColor: importing ? '#94a3b8' : '#0284c7',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: importing ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                }}
              >
                {importing ? (
                  <>
                    <span>⏳</span>
                    <span>{importProgress || 'Importation en cours...'}</span>
                  </>
                ) : (
                  <>
                    <span>🚀</span>
                    <span>Valider & Importer {parseResult.validCount} séances dans le Cloud</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
