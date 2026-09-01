import { supabase } from '../services/api/supabase';
import {
  acknowledgeTournamentDocument,
  createTournamentAnnouncementDraft,
  createTournamentDocument,
  loadPublishedTournamentDocuments,
  loadTournamentAnnouncement,
  loadTournamentCommunicationsAdminContext,
  loadTournamentCommunicationsInbox,
  markTournamentAnnouncementRead,
  previewTournamentAnnouncementAudience,
  publishTournamentAnnouncement,
  replaceTournamentAnnouncementAudience,
  setTournamentAnnouncementLink,
  setTournamentAnnouncementAudience,
  updateTournamentAnnouncementDraft,
  updateTournamentNotificationPreferences,
} from '../features/torneos/api/tournamentWorkspaceService';

jest.mock('../services/api/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

describe('tournament communications service contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  test('loads a bounded internal inbox without client identity', async () => {
    await loadTournamentCommunicationsInbox({
      tournamentId: 'tournament-a',
      filter: 'unread',
      limit: 30,
      offset: 60,
      userId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_tournament_communications_inbox', {
      p_tournament_id: 'tournament-a',
      p_filter: 'unread',
      p_limit: 30,
      p_offset: 60,
    });
  });

  test('loads and acknowledges an announcement using only its resource id', async () => {
    await loadTournamentAnnouncement('announcement-a');
    await markTournamentAnnouncementRead({
      announcementId: 'announcement-a',
      confirm: true,
      recipientUserId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'get_tournament_announcement', {
      p_announcement_id: 'announcement-a',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'mark_tournament_announcement_read', {
      p_announcement_id: 'announcement-a',
      p_confirm: true,
    });
  });

  test('creates a draft with server-derived author and structured content', async () => {
    await createTournamentAnnouncementDraft({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
      type: 'general',
      title: 'Título seguro',
      summary: 'Resumen seguro',
      body: 'Contenido seguro',
      priority: 'important',
      acknowledgementMode: 'read',
      idempotencyKey: 'key-a',
      authorUserId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tournament_announcement_draft', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: 'category-a',
      p_announcement_type: 'general',
      p_title: 'Título seguro',
      p_summary: 'Resumen seguro',
      p_body: 'Contenido seguro',
      p_priority: 'important',
      p_acknowledgement_mode: 'read',
      p_scheduled_for: null,
      p_supersedes_id: null,
      p_correction_reason: null,
      p_idempotency_key: 'key-a',
    });
  });

  test('defines an audience by criteria, never by recipient arrays', async () => {
    await setTournamentAnnouncementAudience({
      announcementId: 'announcement-a',
      type: 'team',
      teamEntryId: 'team-a',
      recipients: ['forged-user'],
    });
    expect(supabase.rpc).toHaveBeenCalledWith('set_tournament_announcement_audience', {
      p_announcement_id: 'announcement-a',
      p_audience_type: 'team',
      p_category_id: null,
      p_team_entry_id: 'team-a',
      p_match_id: null,
      p_specific_user_id: null,
    });
  });

  test('updates a draft and atomically replaces the composer audience', async () => {
    await updateTournamentAnnouncementDraft({
      announcementId: 'announcement-a',
      title: 'Título actualizado',
      summary: 'Resumen actualizado',
      body: 'Contenido actualizado',
      priority: 'urgent',
      acknowledgementMode: 'explicit',
    });
    await replaceTournamentAnnouncementAudience({
      announcementId: 'announcement-a',
      type: 'team',
      teamEntryId: 'team-a',
      recipients: ['forged-user'],
    });
    await setTournamentAnnouncementLink({
      announcementId: 'announcement-a',
      type: 'match',
      resourceId: 'match-a',
      label: 'Ver partido',
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'update_tournament_announcement_draft',
      {
        p_announcement_id: 'announcement-a',
        p_title: 'Título actualizado',
        p_summary: 'Resumen actualizado',
        p_body: 'Contenido actualizado',
        p_priority: 'urgent',
        p_acknowledgement_mode: 'explicit',
        p_scheduled_for: null,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'replace_tournament_announcement_audience',
      {
        p_announcement_id: 'announcement-a',
        p_audience_type: 'team',
        p_category_id: null,
        p_team_entry_id: 'team-a',
        p_match_id: null,
        p_specific_user_id: null,
      },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      3,
      'set_tournament_announcement_link',
      {
        p_announcement_id: 'announcement-a',
        p_link_type: 'match',
        p_resource_id: 'match-a',
        p_external_url: null,
        p_label: 'Ver partido',
        p_sort_order: 0,
      },
    );
  });

  test('previews then publishes with only an advisory expected count', async () => {
    await previewTournamentAnnouncementAudience('announcement-a');
    await publishTournamentAnnouncement({
      announcementId: 'announcement-a',
      expectedRecipientCount: 12,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'preview_tournament_announcement_audience',
      { p_announcement_id: 'announcement-a' },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'publish_tournament_announcement',
      {
        p_announcement_id: 'announcement-a',
        p_expected_recipient_count: 12,
      },
    );
  });

  test('manages notification preferences only for self', async () => {
    await updateTournamentNotificationPreferences({
      tournamentId: 'tournament-a',
      general: false,
      matchChanges: true,
      callups: true,
      discipline: true,
      documents: false,
      summaries: false,
      userId: 'forged-user',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'update_my_tournament_notification_preferences',
      {
        p_tournament_id: 'tournament-a',
        p_general: false,
        p_match_changes: true,
        p_callups: true,
        p_discipline: true,
        p_documents: false,
        p_summaries: false,
      },
    );
  });

  test('loads participant-safe documents and acknowledges a version', async () => {
    await loadPublishedTournamentDocuments({
      tournamentId: 'tournament-a',
      categoryId: 'category-a',
    });
    await acknowledgeTournamentDocument({ versionId: 'version-a', confirm: true });
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      1,
      'get_published_tournament_documents',
      { p_tournament_id: 'tournament-a', p_category_id: 'category-a' },
    );
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'acknowledge_tournament_document',
      { p_version_id: 'version-a', p_confirm: true },
    );
  });

  test('creates structured documents without storage or file payloads', async () => {
    await createTournamentDocument({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      type: 'regulation',
      title: 'Reglamento',
      summary: 'Resumen',
      body: 'Contenido',
      acknowledgementMode: 'explicit',
      idempotencyKey: 'key-a',
      file: new Blob(['forged']),
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tournament_document', {
      p_organization_id: 'org-a',
      p_tournament_id: 'tournament-a',
      p_category_id: null,
      p_document_type: 'regulation',
      p_title: 'Reglamento',
      p_summary: 'Resumen',
      p_body: 'Contenido',
      p_acknowledgement_mode: 'explicit',
      p_effective_at: null,
      p_idempotency_key: 'key-a',
    });
  });

  test('loads admin context with organization scope revalidated by backend', async () => {
    await loadTournamentCommunicationsAdminContext({
      organizationId: 'org-a',
      tournamentId: 'tournament-a',
      role: 'owner',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_tournament_communications_admin_context',
      { p_organization_id: 'org-a', p_tournament_id: 'tournament-a' },
    );
  });

  test('maps denied communication errors to safe copy', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'TORNEOS_COMMUNICATION_FORBIDDEN private_table' },
    });
    await expect(loadTournamentAnnouncement('foreign')).rejects.toEqual(
      expect.objectContaining({
        code: 'TORNEOS_COMMUNICATION_FORBIDDEN',
        message: 'Ese comunicado no está disponible para tu perfil.',
      }),
    );
  });
});
