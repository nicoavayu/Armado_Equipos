import React, { useState, useRef, useEffect } from 'react';
import { updateProfile, uploadAvatar } from '../supabase';

const ProfileModal = ({ user, profile, onClose, onUpdate }) => {
  const [displayName, setDisplayName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  // Update local state when profile changes
  useEffect(() => {
    setDisplayName(profile?.nombre || user?.user_metadata?.full_name || '');
  }, [profile, user]);



  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('File size must be less than 2MB');
      return;
    }

    try {
      setUploading(true);
      const avatarUrl = await uploadAvatar(user.id, file);
      await updateProfile(undefined, avatarUrl);
      await onUpdate(); // Refresh profile data
    } catch (error) {
      alert('Error uploading image');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateProfile(displayName, undefined);
      await onUpdate(); // Refresh profile data
      onClose(); // Close modal after successful save
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Error updating profile');
    } finally {
      setSaving(false);
    }
  };

  const currentAvatar = profile?.avatar_url || user?.user_metadata?.avatar_url || 
    `https://api.dicebear.com/7.x/initials/svg?seed=${user?.email}`;

  return (
    <div className="modal-overlay">
      <div className="profile-modal">
        <div className="modal-header">
          <h2>My Profile</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-content">
          <div className="avatar-section">
            <img src={currentAvatar} alt="Avatar" className="profile-avatar" />
            <button 
              className="change-avatar-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Change Photo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <div className="form-group">
            <label>Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="profile-input"
              placeholder="Enter your name"
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={user?.email || ''}
              className="profile-input"
              disabled
            />
          </div>

          <div className="modal-actions">
            <button className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button 
              className="save-btn" 
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;