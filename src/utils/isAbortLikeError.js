export const isAbortLikeError = (error) => {
  if (!error) return false;

  const name = String(error?.name || error?.code || '').toLowerCase();
  if (name === 'aborterror') return true;

  const message = String(error?.message || error?.details || error?.hint || '').toLowerCase();

  return (
    message.includes('aborterror')
    || message.includes('signal is aborted')
    || message.includes('aborted without reason')
    || message.includes('request aborted')
    || message.includes('the user aborted a request')
  );
};

export default isAbortLikeError;
