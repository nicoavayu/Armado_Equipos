import React from 'react';

// BEFORE: global delete confirmation (centrado, obligaba scrollear)
// ConfirmModal used to render a centered overlay modal. We disable it to enforce inline confirmations only.

const ConfirmModal = (props) => {
  // AFTER: inline confirmation inside the card (pendingDeleteId === partido.id)
  // Disabled global ConfirmModal to prevent any centered modal/portal confirmations.
  return null;
};

export default ConfirmModal;