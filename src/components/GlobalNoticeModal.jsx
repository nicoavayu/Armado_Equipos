import React, { useEffect, useMemo, useState } from 'react';
import ConfirmModal from './ConfirmModal';
import {
  closeGlobalNotice,
  getGlobalNoticeSnapshot,
  subscribeGlobalNotice,
} from '../utils/globalNoticeModal';

export default function GlobalNoticeModal() {
  const [snapshot, setSnapshot] = useState(() => getGlobalNoticeSnapshot());

  useEffect(() => subscribeGlobalNotice(setSnapshot), []);

  const notice = snapshot?.current || null;
  const isOpen = Boolean(snapshot?.isOpen && notice?.message);

  const title = useMemo(() => notice?.title || 'Aviso', [notice]);
  const message = useMemo(() => notice?.message || '', [notice]);
  const confirmText = useMemo(() => notice?.confirmText || 'Entendido', [notice]);

  return (
    <ConfirmModal
      isOpen={isOpen}
      title={title}
      message={message}
      confirmText={confirmText}
      singleButton
      danger={Boolean(notice?.danger)}
      actionsAlign="center"
      onConfirm={closeGlobalNotice}
      onCancel={closeGlobalNotice}
    />
  );
}

