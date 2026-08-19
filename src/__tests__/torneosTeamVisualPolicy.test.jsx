import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamVisualPolicySettings from '../features/torneos/components/TeamVisualPolicySettings';
import BrandingAssetField from '../features/torneos/components/BrandingAssetField';
import PlayerPortraitActions from '../features/torneos/components/PlayerPortraitActions';
import {
  TEAM_VISUAL_POLICIES,
  TEAM_VISUAL_POLICY_OPTIONS,
  isTeamVisualPolicy,
} from '../features/torneos/domain/teamVisualPolicy';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: { from: jest.fn(() => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) })) },
  },
}));

const organizationId = '11111111-1111-4111-8111-111111111111';
const tournamentId = '22222222-2222-4222-8222-222222222222';

function makeService(settings) {
  return {
    loadTeamVisualPolicy: jest.fn().mockResolvedValue(settings),
    setTeamVisualPolicy: jest.fn(async ({ policy }) => ({ ...settings, policy })),
  };
}

async function renderSettings(settings) {
  const service = makeService(settings);
  render(
    <TeamVisualPolicySettings
      organizationId={organizationId}
      tournamentId={tournamentId}
      service={service}
    />,
  );
  await screen.findByRole('radiogroup');
  return service;
}

describe('1C.3A — política de autogestión visual', () => {
  test('el contrato tiene exactamente los tres valores del producto', () => {
    expect(TEAM_VISUAL_POLICY_OPTIONS.map((option) => option.value)).toEqual([
      'organization_only', 'delegates', 'roster',
    ]);
    expect(isTeamVisualPolicy('organization_only')).toBe(true);
    expect(isTeamVisualPolicy('everyone')).toBe(false);
    expect(isTeamVisualPolicy(undefined)).toBe(false);
  });

  test('muestra el valor persistido y el copy de la organización como límite', async () => {
    await renderSettings({
      policy: TEAM_VISUAL_POLICIES.ORGANIZATION_ONLY, canUpdate: true,
    });
    expect(screen.getByRole('radio', { name: /Sólo la organización/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Delegados y capitanes/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Todo el plantel/ })).not.toBeChecked();
    expect(
      screen.getByText(/La organización\s+siempre puede editar o quitar cualquier imagen/),
    ).toBeInTheDocument();
  });

  test('cambiar la política viaja al servidor y refleja lo que el servidor devuelve', async () => {
    const service = await renderSettings({
      policy: TEAM_VISUAL_POLICIES.ORGANIZATION_ONLY, canUpdate: true,
    });
    await userEvent.click(screen.getByRole('radio', { name: /Delegados y capitanes/ }));
    await waitFor(() => {
      expect(service.setTeamVisualPolicy).toHaveBeenCalledWith({
        organizationId, tournamentId, policy: 'delegates',
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Delegados y capitanes/ })).toBeChecked();
    });
    expect(screen.getByRole('radio', { name: /Sólo la organización/ })).not.toBeChecked();
  });

  test('sin capability de actualización la configuración se ve pero no se cambia', async () => {
    const service = await renderSettings({
      policy: TEAM_VISUAL_POLICIES.ROSTER, canUpdate: false,
    });
    for (const option of TEAM_VISUAL_POLICY_OPTIONS) {
      expect(screen.getByRole('radio', { name: new RegExp(option.label) })).toBeDisabled();
    }
    expect(screen.getByRole('radio', { name: /Todo el plantel/ })).toBeChecked();
    expect(screen.getByText(/no cambiarla/)).toBeInTheDocument();
    expect(service.setTeamVisualPolicy).not.toHaveBeenCalled();
  });

  test('un error del servidor no inventa un valor local', async () => {
    const service = {
      loadTeamVisualPolicy: jest.fn().mockResolvedValue({
        policy: TEAM_VISUAL_POLICIES.DELEGATES, canUpdate: true,
      }),
      setTeamVisualPolicy: jest.fn().mockRejectedValue(new Error('TORNEOS_VISUAL_POLICY_FORBIDDEN')),
    };
    render(
      <TeamVisualPolicySettings
        organizationId={organizationId}
        tournamentId={tournamentId}
        service={service}
      />,
    );
    await screen.findByRole('radiogroup');
    await userEvent.click(screen.getByRole('radio', { name: /Todo el plantel/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('TORNEOS_VISUAL_POLICY_FORBIDDEN');
    expect(screen.getByRole('radio', { name: /Delegados y capitanes/ })).toBeChecked();
  });
});

describe('1C.3A — los CTA siguen al permiso, no al rol', () => {
  test('el escudo no ofrece controles sin permiso y ofrece los aprobados con permiso', () => {
    const { rerender } = render(
      <BrandingAssetField
        organizationId={organizationId}
        kind="team"
        entityId={tournamentId}
        path={null}
        name="Barrio Norte FC"
        canEdit={false}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    // Sin permiso la identidad visual se sigue viendo: lo que desaparece es el CTA.
    expect(screen.getByText('Escudo del equipo')).toBeInTheDocument();

    rerender(
      <BrandingAssetField
        organizationId={organizationId}
        kind="team"
        entityId={tournamentId}
        path={null}
        name="Barrio Norte FC"
        canEdit
      />,
    );
    expect(screen.getByRole('button', { name: /Subir/ })).toBeInTheDocument();
  });

  test('el retrato no ofrece controles sin permiso', () => {
    const { rerender } = render(
      <PlayerPortraitActions
        organizationId={organizationId}
        rosterPlayerId="33333333-3333-4333-8333-333333333333"
        playerName="Bruno Giménez"
        portrait={null}
        canManage={false}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <PlayerPortraitActions
        organizationId={organizationId}
        rosterPlayerId="33333333-3333-4333-8333-333333333333"
        playerName="Bruno Giménez"
        portrait={null}
        canManage
      />,
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
