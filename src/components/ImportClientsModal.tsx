import React, { useState, useRef } from 'react';
import { ClientProfile } from '../types';
import {
  downloadClientExcelTemplate,
  parseClientsFile,
  ParsedClientsResult,
} from '../utils/excelImportExport';
import { batchSaveClientsToFirestore } from '../utils/firebaseSync';

interface ImportClientsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: (count: number) => void;
}

export const ImportClientsModal: React.FC<ImportClientsModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParsedClientsResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (selectedFile: File) => {
    setErrorMessage(null);
    setSuccessCount(null);
    setFile(selectedFile);
    setIsLoading(true);

    try {
      const result = await parseClientsFile(selectedFile);
      setParseResult(result);
    } catch (err: any) {
      console.error('Erreur lecture fichier clients:', err);
      setErrorMessage(
        err?.message ||
          "Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un fichier Excel (.xlsx, .xls) ou CSV valide."
      );
      setParseResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSaveToCloud = async () => {
    if (!parseResult) return;
    const validClients: ClientProfile[] = parseResult.items
      .filter(item => item.isValid && item.client)
      .map(item => item.client!);

    if (validClients.length === 0) {
      setErrorMessage('Aucun client valide à importer.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const savedCount = await batchSaveClientsToFirestore(validClients);
      setSuccessCount(savedCount);
      onImportComplete?.(savedCount);
    } catch (err: any) {
      console.error('Erreur enregistrement clients Firestore:', err);
      setErrorMessage(
        "Erreur lors de l'enregistrement dans le Cloud. Vérifiez votre connexion internet."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParseResult(null);
    setErrorMessage(null);
    setSuccessCount(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--card, #ffffff)',
          color: 'var(--tx, #0f172a)',
          borderRadius: '12px',
          maxWidth: '840px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
          border: '1px solid var(--bd, #e2e8f0)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--bd, #e2e8f0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--cell, #f8fafc)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>👥</span> Import du Fichier Clients (Excel / CSV)
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--mu, #64748b)' }}>
              Importez en bloc vos contacts, stagiaires et carnets dans le répertoire de l'école.
            </p>
          </div>
          <button
            type="button"
            className="fbtn"
            style={{ margin: 0, padding: '6px 10px', fontSize: '0.85rem' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Corps défilable */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {/* Succès après import */}
          {successCount !== null ? (
            <div
              style={{
                textAlign: 'center',
                padding: '30px 20px',
                background: '#f0fdf4',
                borderRadius: '8px',
                border: '1px solid #bbf7d0',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎉</div>
              <h4 style={{ margin: '0 0 6px', color: '#166534', fontSize: '1.2rem', fontWeight: 800 }}>
                Importation réussie !
              </h4>
              <p style={{ margin: '0 0 16px', color: '#15803d', fontSize: '0.9rem' }}>
                <b>{successCount}</b> fiches clients ont été synchronisées dans le Cloud Firestore.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <button
                  type="button"
                  className="fbtn fbtn-primary"
                  style={{ background: '#16a34a', color: '#fff', fontWeight: 800 }}
                  onClick={onClose}
                >
                  ✓ Accéder au Répertoire Clients
                </button>
                <button
                  type="button"
                  className="fbtn"
                  onClick={handleReset}
                >
                  Importer un autre fichier
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Zone de glisser-déposer / sélection */}
              {!parseResult && (
                <div>
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                    style={{
                      border: '2px dashed var(--bd, #cbd5e1)',
                      borderRadius: '10px',
                      padding: '32px 20px',
                      textAlign: 'center',
                      background: 'var(--cell, #f8fafc)',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>📁</div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '4px' }}>
                      Glissez votre fichier Excel (.xlsx, .xls) ou CSV ici
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--mu, #64748b)', marginBottom: '14px' }}>
                      ou cliquez pour parcourir les fichiers de votre ordinateur
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      style={{ display: 'none' }}
                      onChange={e => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleFileChange(e.target.files[0]);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        background: '#0284c7',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        padding: '7px 16px',
                        borderRadius: '6px',
                      }}
                      onClick={e => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Sélectionner un fichier
                    </button>
                  </div>

                  {/* Bouton modèle vierge */}
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '12px 16px',
                      background: '#f0f9ff',
                      borderRadius: '8px',
                      border: '1px solid #bae6fd',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px',
                    }}
                  >
                    <div>
                      <b style={{ color: '#0369a1', fontSize: '0.85rem' }}>
                        📋 Pas encore de fichier au bon format ?
                      </b>
                      <div style={{ fontSize: '0.74rem', color: '#0284c7', marginTop: '2px' }}>
                        Téléchargez le modèle Excel type avec colonnes pré-remplies (Nom, Tél, Email, Niveau, Matériel).
                      </div>
                    </div>
                    <button
                      type="button"
                      className="fbtn"
                      style={{
                        margin: 0,
                        background: '#fff',
                        color: '#0369a1',
                        border: '1px solid #0284c7',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        padding: '6px 12px',
                        borderRadius: '6px',
                      }}
                      onClick={downloadClientExcelTemplate}
                    >
                      📥 Télécharger Modèle Excel Vierge
                    </button>
                  </div>
                </div>
              )}

              {/* Indicateur de chargement */}
              {isLoading && (
                <div style={{ textAlign: 'center', padding: '30px' }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⏳</div>
                  <div style={{ fontWeight: 700 }}>Analyse du fichier en cours...</div>
                </div>
              )}

              {/* Message d'erreur */}
              {errorMessage && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#991b1b',
                    fontSize: '0.8rem',
                    marginBottom: '14px',
                  }}
                >
                  ⚠️ <b>Erreur :</b> {errorMessage}
                </div>
              )}

              {/* Prévisualisation des données lues */}
              {parseResult && !isLoading && (
                <div>
                  {/* Bilan du fichier */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '10px',
                      marginBottom: '14px',
                      padding: '10px 14px',
                      background: 'var(--cell, #f8fafc)',
                      borderRadius: '8px',
                      border: '1px solid var(--bd, #e2e8f0)',
                    }}
                  >
                    <div>
                      <b style={{ fontSize: '0.88rem' }}>📄 {file?.name}</b>
                      <div style={{ fontSize: '0.74rem', color: 'var(--mu, #64748b)', marginTop: '2px' }}>
                        <b>{parseResult.validCount}</b> clients valides détectés sur{' '}
                        <b>{parseResult.totalRows}</b> lignes
                        {parseResult.errorCount > 0 && (
                          <span style={{ color: '#dc2626', marginLeft: '6px' }}>
                            ({parseResult.errorCount} ignorés / incomplets)
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="fbtn"
                      style={{ margin: 0, padding: '5px 10px', fontSize: '0.72rem' }}
                      onClick={handleReset}
                    >
                      Changer de fichier
                    </button>
                  </div>

                  {/* Tableau d'aperçu */}
                  <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--bd, #e2e8f0)', borderRadius: '6px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--cell, #f1f5f9)', zIndex: 1 }}>
                        <tr style={{ borderBottom: '1px solid var(--bd, #cbd5e1)' }}>
                          <th style={{ padding: '8px 10px' }}>Nom & Prénom</th>
                          <th style={{ padding: '8px 10px' }}>Téléphone</th>
                          <th style={{ padding: '8px 10px' }}>Email</th>
                          <th style={{ padding: '8px 10px' }}>Ville</th>
                          <th style={{ padding: '8px 10px' }}>Niveau</th>
                          <th style={{ padding: '8px 10px' }}>Matériel</th>
                          <th style={{ padding: '8px 10px' }}>Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseResult.items.map((item, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: '1px solid var(--bd, #f1f5f9)',
                              background: !item.isValid
                                ? '#fef2f2'
                                : idx % 2 === 0
                                ? 'transparent'
                                : 'var(--cell, #f8fafc)',
                            }}
                          >
                            <td style={{ padding: '7px 10px', fontWeight: 700 }}>
                              {item.client ? `${item.client.lastName} ${item.client.firstName || ''}` : item.raw?.Nom || '—'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {item.client?.phone || <span style={{ color: '#dc2626' }}>Manquant</span>}
                            </td>
                            <td style={{ padding: '7px 10px', color: 'var(--mu, #64748b)' }}>
                              {item.client?.email || '—'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {item.client?.city || '—'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {item.client?.level || '—'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {item.client?.preferredGear || '—'}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              {item.isValid ? (
                                <span style={{ color: '#16a34a', fontWeight: 800 }}>✓ Prêt</span>
                              ) : (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}>{item.error}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pied de modal avec actions */}
        {successCount === null && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--bd, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--cell, #f8fafc)',
            }}
          >
            <button type="button" className="fbtn" onClick={onClose} disabled={isSaving}>
              Annuler
            </button>

            {parseResult && (
              <button
                type="button"
                className="fbtn fbtn-primary"
                style={{
                  margin: 0,
                  background: '#16a34a',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.82rem',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  boxShadow: '0 2px 4px rgba(22,163,74,0.3)',
                }}
                disabled={isSaving || parseResult.validCount === 0}
                onClick={handleSaveToCloud}
              >
                {isSaving
                  ? 'Enregistrement en cours...'
                  : `✓ Confirmer l'import (${parseResult.validCount} clients)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
