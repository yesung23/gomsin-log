import type { AppState } from '@/types';
import { resolveRelationshipContext } from '@/lib/relationshipContext';

/**
 * Build a portable snapshot containing only data authored by the requesting
 * account. Role is not identity: using `authorRole` here can export a partner's
 * content after a role correction or malformed legacy row.
 */
export function buildPersonalExport(state: AppState, userId: string, exportedAt = new Date().toISOString()) {
  const ownRecords = state.records.filter((record) => record.userId === userId);
  const ownEvents = state.events.filter((event) => event.createdBy === userId);
  const ownTrips = state.trips.filter((trip) => trip.createdBy === userId);
  const isMilitaryRelationship = resolveRelationshipContext(
    state.profile.couple.relationshipContext,
  ) === 'military';

  return {
    exportedAt,
    app: 'gomsinlog',
    schemaVersion: 2,
    profile: {
      myName: state.profile.myName,
      role: state.profile.role,
      anniversaryDate: state.profile.couple.anniversaryDate ?? null,
      military: isMilitaryRelationship && state.profile.role === 'soldier'
        ? state.profile.military
        : null,
    },
    records: ownRecords.map((record) => ({
      date: record.date,
      time: record.time,
      log: record.log,
      reaction: record.reaction ?? null,
      isPrivate: record.isPrivate,
      talkAbout: record.talkAbout ?? false,
      emotionFlow: record.emotionFlow ?? [],
      attachments: (record.attachments ?? []).map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        // Storage paths are stable; signed URLs expire and are not backups.
        path: attachment.path ?? null,
      })),
      createdAt: record.createdAt,
    })),
    events: ownEvents.map((event) => ({
      title: event.title,
      eventType: event.eventType,
      startDate: event.startDate,
      endDate: event.endDate ?? null,
      isPrivate: event.isPrivate,
      talkAbout: event.talkAbout ?? false,
      createdAt: event.createdAt,
    })),
    trips: ownTrips.map((trip) => ({
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      status: trip.status,
      createdAt: trip.createdAt,
    })),
  };
}
