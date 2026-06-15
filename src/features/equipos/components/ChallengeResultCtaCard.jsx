import React from 'react';
import Button from '../../../components/Button';

const ChallengeResultCtaCard = ({
  rivalName,
  resultLabel = null,
  canEdit = false,
  onLoad,
}) => {
  const safeRivalName = String(rivalName || 'el rival').trim() || 'el rival';
  const hasResult = Boolean(resultLabel);

  return (
    <section
      className="mt-3 rounded-[18px] border border-[#8f7bff]/35 bg-[linear-gradient(160deg,rgba(139,92,255,0.16),rgba(255,255,255,0.045))] p-4 shadow-[0_18px_34px_rgba(7,4,22,0.26)]"
      aria-label="Resultado del desafío"
    >
      {hasResult ? (
        <>
          <p className="font-oswald text-[18px] font-semibold text-white">
            Resultado cargado: {resultLabel}
          </p>
          {canEdit ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-3 h-11 w-full rounded-xl text-[16px] font-oswald font-semibold !normal-case"
              onClick={onLoad}
              data-preserve-button-case="true"
            >
              Editar respuesta
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <p className="font-oswald text-[19px] font-semibold text-white">
            Resultado pendiente
          </p>
          <p className="mt-1 text-[14px] leading-snug text-white/72">
            ¿Cómo salió el desafío contra {safeRivalName}?
          </p>
          <Button
            type="button"
            className="mt-3 h-12 w-full rounded-xl text-[17px] font-oswald font-semibold !normal-case"
            onClick={onLoad}
            data-preserve-button-case="true"
          >
            Responder
          </Button>
        </>
      )}
    </section>
  );
};

export default ChallengeResultCtaCard;
