import React, { useState } from 'react';
import { TeamNote, TeamNoteCategory } from '../types';
import {
  addTeamNoteToFirestore,
  deleteTeamNoteFromFirestore,
  toggleTeamNoteResolvedInFirestore,
} from '../utils/firebaseSync';

interface TeamExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: TeamNote[];
  currentUserName?: string;
}

export const TeamExchangeModal: React.FC<TeamExchangeModalProps> = ({
  isOpen,
  onClose,
  notes,
  currentUserName = 'Jérôme',
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Formulaire d'ajout
  const [author, setAuthor] = useState<string>(() => {
    if (currentUserName && currentUserName.toLowerCase().includes('ben')) return 'Benoît';
    return 'Jérôme';
  });
  const [category, setCategory] = useState<TeamNoteCategory>('terrain');
  const [content, setContent] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;

    setIsSubmitting(true);
    try {
      await addTeamNoteToFirestore({
        author,
        category,
        content: text,
        createdAt: Date.now(),
        isResolved: false,
      });
      setContent('');
    } catch (err) {
      console.error('Erreur ajout note d\'équipe:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleResolved = async (note: TeamNote) => {
    const nextState = !note.isResolved;
    try {
      await toggleTeamNoteResolvedInFirestore(note.id, nextState, author);
    } catch (err) {
      console.error('Erreur mise à jour note:', err);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!window.confirm('Supprimer cette note du carnet de liaison ?')) return;
    try {
      await deleteTeamNoteFromFirestore(noteId);
    } catch (err) {
      console.error('Erreur suppression note:', err);
    }
  };

  const filteredNotes = notes.filter(n => {
    if (filterStatus === 'open' && n.isResolved) return false;
    if (filterStatus === 'resolved' && !n.isResolved) return false;
    if (filterCategory !== 'all' && n.category !== filterCategory) return false;
    return true;
  });

  const openCount = notes.filter(n => !n.isResolved).length;

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Aujourd'hui à ${timeStr}`;
    return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${timeStr}`;
  };

  const getCategoryBadge = (cat: TeamNoteCategory) => {
    switch (cat) {
      case 'terrain':
        return { label: '🏖️ Terrain / Plage', bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
      case 'technique':
        return { label: '⚙️ Marées & Calculs', bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' };
      case 'organisation':
        return { label: '📋 Organisation & Matériel', bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' };
      default:
        return { label: '💬 Échange', bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.70)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '680px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1.5px solid #e2e8f0',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Entête */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>💬</span>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                Espace d'échange Ben ↔ Jérôme
              </h2>
              {openCount > 0 && (
                <span
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '12px',
                  }}
                  title={`${openCount} note(s) en attente`}
                >
                  {openCount} en cours
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Carnet de liaison, retours terrain de Lestrevet et notes de calage en temps réel.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1rem',
              color: '#64748b',
              fontWeight: 700,
            }}
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Corps défilable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {/* Formulaire de nouveau message */}
          <form
            onSubmit={handleSubmit}
            style={{
              background: '#f8fafc',
              border: '1.5px solid #cbd5e1',
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '18px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
              {/* Choix de l'auteur */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569' }}>Auteur :</span>
                <button
                  type="button"
                  onClick={() => setAuthor('Jérôme')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: author === 'Jérôme' ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: author === 'Jérôme' ? '#e0f2fe' : '#ffffff',
                    color: author === 'Jérôme' ? '#0369a1' : '#475569',
                  }}
                >
                  ⛵ Jérôme
                </button>
                <button
                  type="button"
                  onClick={() => setAuthor('Benoît')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: author === 'Benoît' ? '1.5px solid #d97706' : '1px solid #cbd5e1',
                    background: author === 'Benoît' ? '#fef3c7' : '#ffffff',
                    color: author === 'Benoît' ? '#92400e' : '#475569',
                  }}
                >
                  💻 Benoît
                </button>
              </div>

              {/* Choix catégorie */}
              <select
                value={category}
                onChange={e => setCategory(e.target.value as TeamNoteCategory)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.76rem',
                  background: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                }}
              >
                <option value="terrain">🏖️ Terrain / Plage</option>
                <option value="technique">⚙️ Marées & Calculs</option>
                <option value="organisation">📋 Organisation & Matériel</option>
                <option value="autre">💬 Autre échange</option>
              </select>
            </div>

            <textarea
              rows={3}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Écrivez un retour de séance, une observation sur l'état de la plage ou une question technique..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                padding: '10px',
                fontSize: '0.84rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                background: '#ffffff',
                marginBottom: '10px',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={isSubmitting || !content.trim()}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 16px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: content.trim() ? 'pointer' : 'not-allowed',
                  opacity: content.trim() ? 1 : 0.6,
                }}
              >
                {isSubmitting ? 'Envoi…' : 'Poster la note ✉️'}
              </button>
            </div>
          </form>

          {/* Filtres de la liste */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                style={{
                  padding: '3px 9px',
                  borderRadius: '5px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  border: filterStatus === 'all' ? '1px solid #0284c7' : '1px solid #cbd5e1',
                  background: filterStatus === 'all' ? '#0284c7' : '#ffffff',
                  color: filterStatus === 'all' ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                Toutes ({notes.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('open')}
                style={{
                  padding: '3px 9px',
                  borderRadius: '5px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  border: filterStatus === 'open' ? '1px solid #d97706' : '1px solid #cbd5e1',
                  background: filterStatus === 'open' ? '#fef3c7' : '#ffffff',
                  color: filterStatus === 'open' ? '#92400e' : '#475569',
                  cursor: 'pointer',
                }}
              >
                En cours ({openCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('resolved')}
                style={{
                  padding: '3px 9px',
                  borderRadius: '5px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  border: filterStatus === 'resolved' ? '1px solid #16a34a' : '1px solid #cbd5e1',
                  background: filterStatus === 'resolved' ? '#dcfce7' : '#ffffff',
                  color: filterStatus === 'resolved' ? '#15803d' : '#475569',
                  cursor: 'pointer',
                }}
              >
                Traitées ({notes.length - openCount})
              </button>
            </div>

            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              style={{
                fontSize: '0.74rem',
                padding: '3px 8px',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
              }}
            >
              <option value="all">Toutes les catégories</option>
              <option value="terrain">🏖️ Terrain</option>
              <option value="technique">⚙️ Marées & Calculs</option>
              <option value="organisation">📋 Organisation</option>
            </select>
          </div>

          {/* Liste des notes */}
          {filteredNotes.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '36px 16px',
                color: '#94a3b8',
                fontSize: '0.84rem',
                border: '1.5px dashed #e2e8f0',
                borderRadius: '12px',
              }}
            >
              <span>Aucun message dans cette section. Vous pouvez laisser une note ci-dessus !</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredNotes.map(n => {
                const badge = getCategoryBadge(n.category);
                const isJerome = n.author.toLowerCase().includes('jérôme') || n.author.toLowerCase().includes('jerome');
                return (
                  <div
                    key={n.id}
                    style={{
                      background: n.isResolved ? '#f8fafc' : '#ffffff',
                      border: n.isResolved ? '1px solid #e2e8f0' : '1.5px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      opacity: n.isResolved ? 0.75 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '5px',
                            background: isJerome ? '#e0f2fe' : '#fef3c7',
                            color: isJerome ? '#0369a1' : '#92400e',
                            border: `1px solid ${isJerome ? '#bae6fd' : '#fde68a'}`,
                          }}
                        >
                          {isJerome ? '⛵ Jérôme' : '💻 Benoît'}
                        </span>

                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: badge.bg,
                            color: badge.text,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {badge.label}
                        </span>

                        <span style={{ fontSize: '0.70rem', color: '#94a3b8' }}>
                          {formatDate(n.createdAt)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleResolved(n)}
                          style={{
                            border: 'none',
                            background: n.isResolved ? '#dcfce7' : '#f1f5f9',
                            color: n.isResolved ? '#15803d' : '#64748b',
                            borderRadius: '5px',
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title={n.isResolved ? 'Marquer comme non résolu' : 'Marquer comme traité'}
                        >
                          <span>{n.isResolved ? '✓ Traité' : '○ En cours'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(n.id)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            padding: '2px 4px',
                          }}
                          title="Supprimer la note"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: '#1e293b',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {n.content}
                    </div>

                    {n.isResolved && n.resolvedBy && (
                      <div style={{ marginTop: '6px', fontSize: '0.68rem', color: '#16a34a' }}>
                        ✓ Validé / traité par {n.resolvedBy}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pied de fenêtre */}
        <div
          style={{
            padding: '12px 22px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            ☁️ Synchronisation Cloud instantanée
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '0.80rem',
              fontWeight: 700,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
