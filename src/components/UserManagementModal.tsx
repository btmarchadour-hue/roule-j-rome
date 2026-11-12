import React, { useState, useEffect } from 'react';
import { ActiveUserSession, AppUser, UserRole } from '../types';
import { hashPassword } from '../utils/authUtils';
import {
  deleteUserFromFirestore,
  saveUserToFirestore,
  subscribeToUsers,
} from '../utils/firebaseSync';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: ActiveUserSession | null;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Formulaire d'ajout
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newDisplayName, setNewDisplayName] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [newRole, setNewRole] = useState<UserRole>('moniteur');
  const [newIsReadOnly, setNewIsReadOnly] = useState<boolean>(false);

  // Édition de mot de passe en cours
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [updatedPasswordInput, setUpdatedPasswordInput] = useState<string>('');

  // Confirmation de suppression
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeToUsers(
      loaded => {
        setUsers(loaded);
      },
      err => {
        console.warn('Erreur chargement utilisateurs:', err);
      }
    );
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const isAdmin = currentUser?.role === 'admin';

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setFeedback({ type: 'error', msg: 'Accès refusé : seuls Jérôme (Moniteur) et Concepteur : Benoît peuvent créer des comptes.' });
      return;
    }

    const trimmedUsername = newUsername.trim();
    const trimmedPass = newPassword.trim();

    if (!trimmedUsername) {
      setFeedback({ type: 'error', msg: 'Veuillez saisir un prénom ou nom d\'utilisateur.' });
      return;
    }
    if (trimmedPass.length < 4) {
      setFeedback({ type: 'error', msg: 'Le mot de passe doit comporter au moins 4 caractères.' });
      return;
    }

    // Vérifier si un utilisateur porte déjà ce nom
    const exists = users.some(u => u.username.toLowerCase() === trimmedUsername.toLowerCase());
    if (exists) {
      setFeedback({ type: 'error', msg: `Un profil avec le prénom "${trimmedUsername}" existe déjà.` });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const pHash = await hashPassword(trimmedPass);
      const cleanId = `usr_${trimmedUsername
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '_')}`;

      const newUser: AppUser = {
        id: cleanId,
        username: trimmedUsername,
        displayName: newDisplayName.trim() || `${trimmedUsername} (${newRole === 'admin' ? 'Admin' : 'Moniteur'})`,
        role: newRole,
        passwordHash: pHash,
        isReadOnly: newRole === 'moniteur' ? true : newIsReadOnly,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveUserToFirestore(newUser);
      setFeedback({ type: 'success', msg: `✓ Compte créé pour ${trimmedUsername} avec succès !` });
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRole('moniteur');
      setNewIsReadOnly(false);
      setShowAddForm(false);
    } catch (err) {
      console.error('Erreur création utilisateur:', err);
      setFeedback({ type: 'error', msg: 'Erreur lors de la création du compte dans le Cloud.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePassword = async (user: AppUser) => {
    const trimmed = updatedPasswordInput.trim();
    if (trimmed.length < 4) {
      setFeedback({ type: 'error', msg: 'Le nouveau mot de passe doit comporter au moins 4 caractères.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const pHash = await hashPassword(trimmed);
      const updated: AppUser = {
        ...user,
        passwordHash: pHash,
        updatedAt: Date.now(),
      };
      await saveUserToFirestore(updated);
      setFeedback({ type: 'success', msg: `✓ Mot de passe mis à jour pour ${user.username}.` });
      setEditingPasswordUserId(null);
      setUpdatedPasswordInput('');
    } catch (err) {
      console.error('Erreur modif mdp:', err);
      setFeedback({ type: 'error', msg: 'Erreur lors de la mise à jour du mot de passe.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRole = async (user: AppUser) => {
    if (!isAdmin) return;
    const newR: UserRole = user.role === 'admin' ? 'moniteur' : 'admin';
    try {
      const updated: AppUser = {
        ...user,
        role: newR,
        updatedAt: Date.now(),
      };
      await saveUserToFirestore(updated);
      setFeedback({ type: 'success', msg: `✓ Rôle de ${user.username} changé en ${newR === 'admin' ? 'Administrateur' : 'Moniteur'}.` });
    } catch (err) {
      console.error('Erreur toggle role:', err);
      setFeedback({ type: 'error', msg: 'Erreur mise à jour rôle.' });
    }
  };

  const handleToggleReadOnly = async (user: AppUser) => {
    if (!isAdmin) return;
    try {
      const updated: AppUser = {
        ...user,
        isReadOnly: !user.isReadOnly,
        updatedAt: Date.now(),
      };
      await saveUserToFirestore(updated);
      setFeedback({
        type: 'success',
        msg: `✓ Mode lecture seule ${updated.isReadOnly ? 'activé' : 'désactivé'} pour ${user.username}.`,
      });
    } catch (err) {
      console.error('Erreur toggle read only:', err);
      setFeedback({ type: 'error', msg: 'Erreur mise à jour statut lecture seule.' });
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (!isAdmin) return;

    if (currentUser?.id === user.id || currentUser?.username === user.username) {
      setFeedback({ type: 'error', msg: 'Impossible de supprimer votre propre compte actuellement connecté.' });
      return;
    }

    const adminCount = users.filter(u => u.role === 'admin').length;
    if (user.role === 'admin' && adminCount <= 1) {
      setFeedback({ type: 'error', msg: 'Impossible de supprimer le dernier compte administrateur.' });
      return;
    }

    try {
      await deleteUserFromFirestore(user.id);
      setFeedback({ type: 'success', msg: `✓ Le profil de ${user.username} a été supprimé.` });
      setDeletingUserId(null);
    } catch (err) {
      console.error('Erreur suppression utilisateur:', err);
      setFeedback({ type: 'error', msg: 'Erreur lors de la suppression du compte.' });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99990,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>👥</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900 }}>
                Gestion des Utilisateurs & Équipe
              </h2>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8' }}>
                Accès administrateur (Jérôme &amp; Concepteur : Benoît) · Profils, rôles et mots de passe
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '1rem',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Message de notification / feedback */}
        {feedback && (
          <div
            style={{
              padding: '10px 16px',
              background: feedback.type === 'success' ? '#dcfce7' : '#fee2e2',
              color: feedback.type === 'success' ? '#166534' : '#991b1b',
              fontSize: '0.78rem',
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            <span>{feedback.msg}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Corps principal */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {/* Barre d'action : bouton ajouter */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#334155' }}>
              Utilisateurs actifs ({users.length}) :
            </div>
            {isAdmin && !showAddForm && (
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(true);
                  setFeedback(null);
                }}
                style={{
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                }}
              >
                <span>➕</span>
                <span>Ajouter un utilisateur</span>
              </button>
            )}
          </div>

          {/* Formulaire d'ajout d'utilisateur */}
          {showAddForm && (
            <form
              onSubmit={handleCreateUser}
              style={{
                background: '#f8fafc',
                border: '1.5px solid #0284c7',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                }}
              >
                <div style={{ fontSize: '0.86rem', fontWeight: 900, color: '#0369a1' }}>
                  ➕ Nouveau Profil Moniteur / Administrateur
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Annuler ✕
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <label
                    htmlFor="new-user-username"
                    style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}
                  >
                    Prénom / Identifiant *
                  </label>
                  <input
                    id="new-user-username"
                    type="text"
                    required
                    placeholder="Ex: Alexandre, Thomas..."
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-user-display-name"
                    style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}
                  >
                    Nom affiché (optionnel)
                  </label>
                  <input
                    id="new-user-display-name"
                    type="text"
                    placeholder="Ex: Alexandre (Moniteur Saison)"
                    value={newDisplayName}
                    onChange={e => setNewDisplayName(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-user-password"
                    style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}
                  >
                    Mot de passe individuel *
                  </label>
                  <input
                    id="new-user-password"
                    type="text"
                    required
                    placeholder="Au moins 4 caractères..."
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-user-role"
                    style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: '#475569', marginBottom: '4px' }}
                  >
                    Rôle dans l&apos;école *
                  </label>
                  <select
                    id="new-user-role"
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as UserRole)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                      background: '#ffffff',
                    }}
                  >
                    <option value="moniteur">⛵ Moniteur (Saisie créneaux & émargement)</option>
                    <option value="admin">⭐ Administrateur (Gestion totale + utilisateurs)</option>
                  </select>
                </div>
              </div>

              {/* Option Lecture seule */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '0.76rem',
                  color: '#475569',
                  marginBottom: '14px',
                }}
              >
                <input
                  type="checkbox"
                  checked={newIsReadOnly}
                  onChange={e => setNewIsReadOnly(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#d97706' }}
                />
                <span>
                  <strong>🔒 Mode Contrôle (Lecture seule)</strong> : l&apos;utilisateur pourra consulter sans risquer de modifier ou supprimer des données.
                </span>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Enregistrement...' : 'Enregistrer le nouveau moniteur ➔'}
                </button>
              </div>
            </form>
          )}

          {/* Liste des utilisateurs existants */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map(u => {
              const isCurrentUser = currentUser?.id === u.id || currentUser?.username === u.username;
              const isJerome = u.username.toLowerCase().includes('jérôme') || u.username.toLowerCase().includes('jerome');
              const isBenoit = u.username.toLowerCase().includes('benoît') || u.username.toLowerCase().includes('benoit');
              const isEditingPass = editingPasswordUserId === u.id;

              return (
                <div
                  key={u.id}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    {/* Identité */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '50%',
                          background: u.role === 'admin' ? '#e0f2fe' : '#f1f5f9',
                          color: u.role === 'admin' ? '#0369a1' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1rem',
                          fontWeight: 800,
                          border: `1.5px solid ${u.role === 'admin' ? '#bae6fd' : '#e2e8f0'}`,
                        }}
                      >
                        {isJerome ? '⛵' : isBenoit ? '👁️' : u.username.slice(0, 1).toUpperCase()}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.90rem', fontWeight: 800, color: '#0f172a' }}>
                            {u.username}
                          </span>
                          {isCurrentUser && (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                background: '#dcfce7',
                                color: '#166534',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 800,
                              }}
                            >
                              Vous
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                          {u.displayName || u.username}
                        </div>
                      </div>
                    </div>

                    {/* Badges de statut & rôle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => handleToggleRole(u)}
                        disabled={!isAdmin || isCurrentUser}
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: 'none',
                          background: u.role === 'admin' ? '#e0f2fe' : '#f1f5f9',
                          color: u.role === 'admin' ? '#0369a1' : '#475569',
                          cursor: isAdmin && !isCurrentUser ? 'pointer' : 'default',
                        }}
                        title={isAdmin && !isCurrentUser ? 'Cliquer pour basculer le rôle Admin/Moniteur' : ''}
                      >
                        {u.role === 'admin' ? '⭐ Administrateur' : '⛵ Moniteur'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleReadOnly(u)}
                        disabled={!isAdmin}
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: 'none',
                          background: u.isReadOnly ? '#fef3c7' : '#f1f5f9',
                          color: u.isReadOnly ? '#92400e' : '#64748b',
                          cursor: isAdmin ? 'pointer' : 'default',
                        }}
                        title="Cliquer pour activer ou désactiver la lecture seule"
                      >
                        {u.isReadOnly ? '🔒 Lecture seule' : '✏️ Écriture active'}
                      </button>

                      {/* Bouton modifier mot de passe */}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingPass) {
                              setEditingPasswordUserId(null);
                            } else {
                              setEditingPasswordUserId(u.id);
                              setUpdatedPasswordInput('');
                            }
                          }}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#475569',
                            cursor: 'pointer',
                          }}
                        >
                          🔑 Mot de passe
                        </button>
                      )}

                      {/* Bouton supprimer */}
                      {isAdmin && !isCurrentUser && (
                        <button
                          type="button"
                          onClick={() => setDeletingUserId(u.id)}
                          style={{
                            background: '#fee2e2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#991b1b',
                            cursor: 'pointer',
                          }}
                          title="Supprimer ce profil moniteur"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Formulaire de modification de mot de passe déplié */}
                  {isEditingPass && (
                    <div
                      style={{
                        background: '#f8fafc',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px dashed #cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#334155' }}>
                        Nouveau mot de passe pour {u.username} :
                      </span>
                      <input
                        type="text"
                        placeholder="Nouveau mot de passe..."
                        value={updatedPasswordInput}
                        onChange={e => setUpdatedPasswordInput(e.target.value)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.76rem',
                          borderRadius: '4px',
                          border: '1px solid #94a3b8',
                          flex: 1,
                          minWidth: '150px',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleChangePassword(u)}
                        disabled={isSubmitting || !updatedPasswordInput.trim()}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          border: 'none',
                          background: '#0284c7',
                          color: '#ffffff',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Enregistrer
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPasswordUserId(null)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  )}

                  {/* Confirmation de suppression dépliée */}
                  {deletingUserId === u.id && (
                    <div
                      style={{
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <span style={{ fontSize: '0.74rem', color: '#9f1239', fontWeight: 700 }}>
                        ⚠️ Confirmer la suppression du profil de {u.username} ?
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          style={{
                            background: '#e11d48',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Oui, supprimer
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingUserId(null)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                          }}
                        >
                          Non, annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Pied de page */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.74rem',
            color: '#64748b',
          }}
        >
          <span>
            Connecté en tant que : <strong>{currentUser?.username || 'Invité'}</strong> ({currentUser?.role === 'admin' ? 'Administrateur' : 'Moniteur'})
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontWeight: 700,
              fontSize: '0.76rem',
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
