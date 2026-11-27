import { Types } from 'mongoose';
import {
  getSupabase,
  fromPgUuid,
  toPgUuid,
  generateHex24Id,
} from '../config/supabase.js';
import {
  cloneValue,
  createMongoDuplicateError,
  reviveDatesDeep,
  type PlainDoc,
} from './supabaseDocEngine.js';

export interface TableAdapter {
  readonly kind: 'supabase' | 'memory';
  readonly uniqueFields?: string[][];
  loadAll(): Promise<PlainDoc[]>;
  loadFiltered?(filter: PlainDoc): Promise<PlainDoc[]>;
  insert(doc: PlainDoc): Promise<PlainDoc>;
  replace(doc: PlainDoc): Promise<PlainDoc>;
  remove(id: unknown): Promise<void>;
}

function extractScalarEq(filter: PlainDoc | undefined, key: string): string | undefined {
  if (!filter || typeof filter !== 'object') return undefined;
  if (filter.$or || filter.$and || filter.$nor) return undefined;
  const val = filter[key];
  if (val === undefined || val === null) return undefined;
  if (val instanceof Types.ObjectId) return val.toString();
  if (typeof val === 'string' && val.trim().length > 0) return val;
  return undefined;
}

function maybeToObjId(id: unknown): Types.ObjectId | string {
  if (id instanceof Types.ObjectId) return id;
  const str = String(id || '');
  if (Types.ObjectId.isValid(str)) return new Types.ObjectId(str);
  return str;
}

interface FilterColumnRule {
  field: string;
  column: string;
  transform?: (val: string) => string;
}

function createFilteredSupabaseLoader(
  table: string,
  mapRow: (row: any) => PlainDoc,
  rules: FilterColumnRule[],
  postFilter?: (row: any) => boolean
): (filter: PlainDoc) => Promise<PlainDoc[]> {
  return async (filter: PlainDoc) => {
    const sb = getSupabase();
    let query: any = sb.from(table).select('*');
    for (const rule of rules) {
      const rawVal = extractScalarEq(filter, rule.field);
      if (rawVal !== undefined) {
        query = query.eq(rule.column, rule.transform ? rule.transform(rawVal) : rawVal);
      }
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = postFilter ? (data || []).filter(postFilter) : data || [];
    return rows.map(mapRow);
  };
}

function safeJsonParse(raw: unknown): Record<string, any> | null {
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toJsonSafe(val: unknown): any {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val.toISOString();
  if (val instanceof Types.ObjectId) return val.toString();
  if (val instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of val.entries()) {
      obj[String(k)] = toJsonSafe(v);
    }
    return obj;
  }
  if (Array.isArray(val)) return val.map(toJsonSafe);
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) out[k] = toJsonSafe(v);
    }
    return out;
  }
  return val;
}

function toObjId(id: unknown): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  const hex = typeof id === 'string' && id.includes('-') ? fromPgUuid(id) : String(id || generateHex24Id());
  return new Types.ObjectId(hex.padEnd(24, '0').slice(0, 24));
}

function throwIfPgUniqueError(err: any, keyPattern?: Record<string, number>): never {
  if (err && (err.code === '23505' || String(err.message || '').toLowerCase().includes('duplicate key'))) {
    throw createMongoDuplicateError(err.message || 'Duplicate key violation', keyPattern);
  }
  throw new Error(err?.message || 'Supabase database operation failed');
}

function mapMeetingStatusToPg(status?: string): 'scheduled' | 'active' | 'ended' | 'cancelled' {
  switch (String(status || '').toUpperCase()) {
    case 'SCHEDULED':
      return 'scheduled';
    case 'ACTIVE':
    case 'CREATED':
      return 'active';
    case 'CANCELLED':
      return 'cancelled';
    case 'ENDED':
    case 'EXPIRED':
    default:
      return 'ended';
  }
}

function mapParticipantRoleToPg(role?: string): 'host' | 'co-host' | 'participant' {
  if (role === 'host' || role === 'co-host' || role === 'participant') return role;
  return 'participant';
}

function mapAdmissionToPg(status?: string): 'admitted' | 'waiting' | 'rejected' | 'left' {
  switch (String(status || '').toUpperCase()) {
    case 'ADMITTED':
      return 'admitted';
    case 'WAITING':
      return 'waiting';
    case 'LEFT':
      return 'left';
    case 'REJECTED':
    case 'REMOVED':
    case 'CANCELLED':
    default:
      return 'rejected';
  }
}

function splitFullName(name: string): { firstName: string; lastName: string } {
  const clean = (name || '').trim();
  if (!clean) return { firstName: 'User', lastName: '' };
  const idx = clean.indexOf(' ');
  if (idx === -1) return { firstName: clean, lastName: '' };
  return { firstName: clean.slice(0, idx), lastName: clean.slice(idx + 1).trim() };
}

// ---------------------------------------------------------------------------
// 1. User <-> public.users + public.user_preferences (video_input_device meta)
// ---------------------------------------------------------------------------
function mapUserRowToDoc(row: any, prefRow?: any): PlainDoc {
  const meta = reviveDatesDeep(safeJsonParse(prefRow?.video_input_device) || {});
  const split = splitFullName(row.name);
  const firstName = meta.firstName ?? split.firstName;
  const lastName = meta.lastName ?? split.lastName;
  const defaultPrefs = {
    defaultAudioMuted: true,
    defaultVideoOff: false,
    enableVirtualBackground: false,
    theme: prefRow?.theme || 'editorial-light',
    notificationSounds: prefRow?.notifications_enabled ?? true,
  };

  return {
    _id: toObjId(fromPgUuid(row.id)),
    email: row.email,
    passwordHash: row.password_hash,
    firstName,
    lastName,
    avatarUrl: row.avatar_url ?? null,
    avatarColor: meta.avatarColor ?? 'sage',
    jobTitle: meta.jobTitle ?? null,
    bio: meta.bio ?? null,
    timeZone: meta.timeZone ?? null,
    googleSub: meta.googleSub ?? null,
    hasLocalPassword: meta.hasLocalPassword ?? true,
    role: row.role || 'user',
    isEmailVerified: meta.isEmailVerified ?? true,
    emailVerificationToken: meta.emailVerificationToken,
    passwordResetToken: meta.passwordResetToken,
    passwordResetExpires: meta.passwordResetExpires ?? null,
    failedLoginAttempts: meta.failedLoginAttempts ?? 0,
    lockoutUntil: meta.lockoutUntil ?? null,
    preferences: { ...defaultPrefs, ...(meta.preferences || {}) },
    preferencesVersion: meta.preferencesVersion ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export const userAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['email']],
  async loadAll() {
    const sb = getSupabase();
    const [{ data: users, error: uErr }, { data: prefs, error: pErr }] = await Promise.all([
      sb.from('users').select('*'),
      sb.from('user_preferences').select('*'),
    ]);
    if (uErr) throw uErr;
    if (pErr) throw pErr;
    const prefByUser = new Map<string, any>((prefs || []).map((p) => [p.user_id, p]));
    return (users || []).map((u) => mapUserRowToDoc(u, prefByUser.get(u.id)));
  },
  async loadFiltered(filter: PlainDoc) {
    const sb = getSupabase();
    const idEq = extractScalarEq(filter, '_id');
    const emailEq = extractScalarEq(filter, 'email');
    let query: any = sb.from('users').select('*');
    if (idEq) query = query.eq('id', toPgUuid(idEq));
    if (emailEq) query = query.eq('email', emailEq.toLowerCase().trim());
    const { data: users, error: uErr } = await query;
    if (uErr) throw uErr;
    if (!users || users.length === 0) return [];
    const uuids = users.map((u: any) => u.id);
    const { data: prefs, error: pErr } = await sb
      .from('user_preferences')
      .select('*')
      .in('user_id', uuids);
    if (pErr) throw pErr;
    const prefByUser = new Map<string, any>((prefs || []).map((p: any) => [p.user_id, p]));
    return users.map((u: any) => mapUserRowToDoc(u, prefByUser.get(u.id)));
  },
  async insert(doc) {
    const sb = getSupabase();
    const idHex = doc._id ? String(doc._id) : generateHex24Id();
    const uuid = toPgUuid(idHex);
    const fullName = `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || doc.email;
    const nowIso = new Date().toISOString();

    const { data, error } = await sb
      .from('users')
      .insert({
        id: uuid,
        email: String(doc.email).toLowerCase().trim(),
        password_hash: doc.passwordHash,
        name: fullName,
        avatar_url: doc.avatarUrl || null,
        role: doc.role === 'admin' ? 'admin' : 'user',
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : nowIso,
        updated_at: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : nowIso,
      })
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { email: 1 });

    const profileMeta = toJsonSafe({
      firstName: doc.firstName,
      lastName: doc.lastName,
      avatarColor: doc.avatarColor ?? 'sage',
      jobTitle: doc.jobTitle ?? null,
      bio: doc.bio ?? null,
      timeZone: doc.timeZone ?? null,
      googleSub: doc.googleSub ?? null,
      hasLocalPassword: doc.hasLocalPassword ?? true,
      isEmailVerified: doc.isEmailVerified ?? true,
      emailVerificationToken: doc.emailVerificationToken,
      passwordResetToken: doc.passwordResetToken,
      passwordResetExpires: doc.passwordResetExpires,
      failedLoginAttempts: doc.failedLoginAttempts ?? 0,
      lockoutUntil: doc.lockoutUntil ?? null,
      preferences: doc.preferences,
      preferencesVersion: doc.preferencesVersion ?? 0,
    });

    const { data: prefRow, error: prefErr } = await sb
      .from('user_preferences')
      .upsert(
        {
          user_id: uuid,
          theme: doc.preferences?.theme || 'editorial-light',
          notifications_enabled: doc.preferences?.notificationSounds ?? true,
          video_input_device: JSON.stringify(profileMeta),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();
    if (prefErr) throw prefErr;

    return mapUserRowToDoc(data, prefRow);
  },
  async replace(doc) {
    const sb = getSupabase();
    const uuid = toPgUuid(doc._id);
    const fullName = `${doc.firstName || ''} ${doc.lastName || ''}`.trim() || doc.email;
    const nowIso = new Date().toISOString();

    const { data, error } = await sb
      .from('users')
      .update({
        email: String(doc.email).toLowerCase().trim(),
        password_hash: doc.passwordHash,
        name: fullName,
        avatar_url: doc.avatarUrl || null,
        role: doc.role === 'admin' ? 'admin' : 'user',
        updated_at: nowIso,
      })
      .eq('id', uuid)
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { email: 1 });

    const { data: existingPref } = await sb
      .from('user_preferences')
      .select('id')
      .eq('user_id', uuid)
      .maybeSingle();

    const profileMeta = toJsonSafe({
      firstName: doc.firstName,
      lastName: doc.lastName,
      avatarColor: doc.avatarColor ?? 'sage',
      jobTitle: doc.jobTitle ?? null,
      bio: doc.bio ?? null,
      timeZone: doc.timeZone ?? null,
      googleSub: doc.googleSub ?? null,
      hasLocalPassword: doc.hasLocalPassword ?? true,
      isEmailVerified: doc.isEmailVerified ?? true,
      emailVerificationToken: doc.emailVerificationToken,
      passwordResetToken: doc.passwordResetToken,
      passwordResetExpires: doc.passwordResetExpires,
      failedLoginAttempts: doc.failedLoginAttempts ?? 0,
      lockoutUntil: doc.lockoutUntil ?? null,
      preferences: doc.preferences,
      preferencesVersion: doc.preferencesVersion ?? 0,
    });

    const themeValue = doc.preferences?.theme || 'editorial-light';
    const notifValue = doc.preferences?.notificationSounds ?? true;
    const { data: prefRow, error: prefErr } = existingPref
      ? await sb
          .from('user_preferences')
          .update({
            theme: themeValue,
            notifications_enabled: notifValue,
            video_input_device: JSON.stringify(profileMeta),
            updated_at: nowIso,
          })
          .eq('user_id', uuid)
          .select()
          .single()
      : await sb
          .from('user_preferences')
          .insert({
            user_id: uuid,
            theme: themeValue,
            notifications_enabled: notifValue,
            video_input_device: JSON.stringify(profileMeta),
            updated_at: nowIso,
          })
          .select()
          .single();
    if (prefErr) throw prefErr;

    return mapUserRowToDoc(data, prefRow);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('users').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 2. UserPreferences <-> public.user_preferences (audio_input_device JSON)
// ---------------------------------------------------------------------------
function mapPrefRowToDoc(row: any): PlainDoc {
  const meta = reviveDatesDeep(safeJsonParse(row.audio_input_device) || {});
  return {
    _id: toObjId(fromPgUuid(row.id)),
    userId: toObjId(fromPgUuid(row.user_id)),
    defaultAudioMuted: meta.defaultAudioMuted ?? true,
    defaultVideoOff: meta.defaultVideoOff ?? false,
    version: meta.version ?? 1,
    fieldVersions: meta.fieldVersions ?? { defaultAudioMuted: 0, defaultVideoOff: 0 },
    fieldTimestamps: meta.fieldTimestamps ?? { defaultAudioMuted: 0, defaultVideoOff: 0 },
    fieldMeta: meta.fieldMeta ?? {
      defaultAudioMuted: { clientSessionId: '', serverUpdatedAt: new Date(0), lastWriteId: '' },
      defaultVideoOff: { clientSessionId: '', serverUpdatedAt: new Date(0), lastWriteId: '' },
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export const userPreferencesAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['userId']],
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('user_preferences').select('*');
    if (error) throw error;
    return (data || []).filter((r) => Boolean(safeJsonParse(r.audio_input_device))).map(mapPrefRowToDoc);
  },
  async insert(doc) {
    return this.replace(doc);
  },
  async replace(doc) {
    const sb = getSupabase();
    const userUuid = toPgUuid(doc.userId);
    const prefUuid = toPgUuid(doc._id || generateHex24Id());
    const nowIso = new Date().toISOString();

    const { data: existingPref } = await sb
      .from('user_preferences')
      .select('id')
      .eq('user_id', userUuid)
      .maybeSingle();

    const prefPayload = toJsonSafe({
      defaultAudioMuted: doc.defaultAudioMuted ?? true,
      defaultVideoOff: doc.defaultVideoOff ?? false,
      version: doc.version ?? 1,
      fieldVersions: doc.fieldVersions ?? { defaultAudioMuted: 0, defaultVideoOff: 0 },
      fieldTimestamps: doc.fieldTimestamps ?? { defaultAudioMuted: 0, defaultVideoOff: 0 },
      fieldMeta: doc.fieldMeta,
    });

    const { data, error } = existingPref
      ? await sb
          .from('user_preferences')
          .update({
            audio_input_device: JSON.stringify(prefPayload),
            updated_at: nowIso,
          })
          .eq('user_id', userUuid)
          .select()
          .single()
      : await sb
          .from('user_preferences')
          .insert({
            id: prefUuid,
            user_id: userUuid,
            audio_input_device: JSON.stringify(prefPayload),
            updated_at: nowIso,
          })
          .select()
          .single();
    if (error) throwIfPgUniqueError(error, { userId: 1 });
    return mapPrefRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('user_preferences').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 3. AuthSession <-> public.auth_sessions
// ---------------------------------------------------------------------------
function mapSessionRowToDoc(row: any): PlainDoc {
  const uaMeta = reviveDatesDeep(safeJsonParse(row.user_agent));
  const isValid = uaMeta?.isValid !== undefined ? Boolean(uaMeta.isValid) : row.revoked_at === null;
  return {
    _id: toObjId(fromPgUuid(row.id)),
    userId: toObjId(fromPgUuid(row.user_id)),
    familyId: uaMeta?.familyId || fromPgUuid(row.id),
    refreshTokenHash: row.refresh_token,
    userAgent: uaMeta ? uaMeta.userAgent : row.user_agent || 'Unknown',
    ipAddress: row.ip_address || 'Unknown',
    isValid,
    rotatedAt: uaMeta?.rotatedAt ?? (row.revoked_at ? new Date(row.revoked_at) : null),
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  };
}

export const authSessionAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['refreshTokenHash']],
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('auth_sessions').select('*');
    if (error) throw error;
    return (data || []).map(mapSessionRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const uuid = toPgUuid(doc._id || generateHex24Id());
    const uaJson = JSON.stringify(
      toJsonSafe({
        userAgent: doc.userAgent || 'Unknown',
        familyId: doc.familyId,
        isValid: doc.isValid !== false,
        rotatedAt: doc.rotatedAt || null,
      })
    );
    const { data, error } = await sb
      .from('auth_sessions')
      .insert({
        id: uuid,
        user_id: toPgUuid(doc.userId),
        refresh_token: doc.refreshTokenHash,
        ip_address: doc.ipAddress || 'Unknown',
        user_agent: uaJson,
        expires_at: new Date(doc.expiresAt).toISOString(),
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
        revoked_at: doc.isValid === false ? new Date(doc.rotatedAt || Date.now()).toISOString() : null,
      })
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { refreshTokenHash: 1 });
    return mapSessionRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const uuid = toPgUuid(doc._id);
    const uaJson = JSON.stringify(
      toJsonSafe({
        userAgent: doc.userAgent || 'Unknown',
        familyId: doc.familyId,
        isValid: doc.isValid !== false,
        rotatedAt: doc.rotatedAt || null,
      })
    );
    const { data, error } = await sb
      .from('auth_sessions')
      .update({
        user_id: toPgUuid(doc.userId),
        refresh_token: doc.refreshTokenHash,
        ip_address: doc.ipAddress || 'Unknown',
        user_agent: uaJson,
        expires_at: new Date(doc.expiresAt).toISOString(),
        revoked_at: doc.isValid === false ? new Date(doc.rotatedAt || Date.now()).toISOString() : null,
      })
      .eq('id', uuid)
      .select()
      .single();
    if (error) throw error;
    return mapSessionRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('auth_sessions').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 4. Meeting <-> public.meetings
// ---------------------------------------------------------------------------
function mapMeetingRowToDoc(row: any): PlainDoc {
  const s = reviveDatesDeep(row.settings || {});
  const extra = s._connectly || {};
  const invitees = Array.isArray(extra.invitees)
    ? extra.invitees.map((inv: any) => ({
        ...inv,
        userId: inv?.userId ? toObjId(inv.userId) : null,
      }))
    : [];
  const auditLog = Array.isArray(extra.auditLog)
    ? extra.auditLog.map((entry: any) => ({
        ...entry,
        actorId: toObjId(entry.actorId),
        targetUserId: entry.targetUserId ? toObjId(entry.targetUserId) : null,
      }))
    : [];

  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingCode: row.code,
    title: row.title,
    description: row.description ?? null,
    hostId: toObjId(fromPgUuid(row.host_id)),
    originalHostId: toObjId(extra.originalHostId || fromPgUuid(row.host_id)),
    status: extra.status || String(row.status || 'ACTIVE').toUpperCase(),
    isLocked: Boolean(row.is_locked),
    maxParticipants: extra.maxParticipants ?? 100,
    activeParticipantCount: extra.activeParticipantCount ?? 0,
    settings: {
      waitingRoomEnabled: s.waitingRoomEnabled ?? false,
      allowCoHostAdmit: s.allowCoHostAdmit ?? true,
      allowCoHostRemove: s.allowCoHostRemove ?? true,
      allowCoHostLock: s.allowCoHostLock ?? false,
    },
    scheduledStartAt: row.scheduled_start ? new Date(row.scheduled_start) : null,
    scheduledEndAt: row.scheduled_end ? new Date(row.scheduled_end) : null,
    scheduledTimeZone: extra.scheduledTimeZone ?? 'UTC',
    scheduledBy: extra.scheduledBy ? toObjId(extra.scheduledBy) : null,
    cancelledAt: extra.cancelledAt ?? null,
    cancelledBy: extra.cancelledBy ? toObjId(extra.cancelledBy) : null,
    cancellationReason: extra.cancellationReason ?? null,
    invitees,
    reminderPreferences: extra.reminderPreferences ?? [15, 60],
    scheduleVersion: extra.scheduleVersion ?? 1,
    version: extra.version ?? 1,
    activatedAt: extra.activatedAt ?? null,
    endedAt: extra.endedAt ?? null,
    expiresAt: extra.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    auditLog,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function buildMeetingPgRow(doc: PlainDoc) {
  const uuid = toPgUuid(doc._id);
  const nowIso = new Date().toISOString();
  const settingsJsonb = toJsonSafe({
    waitingRoomEnabled: doc.settings?.waitingRoomEnabled ?? false,
    allowCoHostAdmit: doc.settings?.allowCoHostAdmit ?? true,
    allowCoHostRemove: doc.settings?.allowCoHostRemove ?? true,
    allowCoHostLock: doc.settings?.allowCoHostLock ?? false,
    _connectly: {
      originalHostId: doc.originalHostId || doc.hostId,
      status: doc.status || 'ACTIVE',
      maxParticipants: doc.maxParticipants ?? 100,
      activeParticipantCount: doc.activeParticipantCount ?? 0,
      scheduledTimeZone: doc.scheduledTimeZone ?? 'UTC',
      scheduledBy: doc.scheduledBy ?? null,
      cancelledAt: doc.cancelledAt ?? null,
      cancelledBy: doc.cancelledBy ?? null,
      cancellationReason: doc.cancellationReason ?? null,
      invitees: doc.invitees ?? [],
      reminderPreferences: doc.reminderPreferences ?? [15, 60],
      scheduleVersion: doc.scheduleVersion ?? 1,
      version: doc.version ?? 1,
      activatedAt: doc.activatedAt ?? null,
      endedAt: doc.endedAt ?? null,
      expiresAt: doc.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      auditLog: doc.auditLog ?? [],
    },
  });

  return {
    id: uuid,
    code: String(doc.meetingCode).toLowerCase().trim(),
    title: doc.title || 'CONNECTLY Meeting',
    description: doc.description ?? null,
    host_id: toPgUuid(doc.hostId),
    status: mapMeetingStatusToPg(doc.status),
    is_locked: Boolean(doc.isLocked),
    scheduled_start: doc.scheduledStartAt ? new Date(doc.scheduledStartAt).toISOString() : null,
    scheduled_end: doc.scheduledEndAt ? new Date(doc.scheduledEndAt).toISOString() : null,
    settings: settingsJsonb,
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : nowIso,
    updated_at: nowIso,
  };
}

export const meetingAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['meetingCode']],
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('meetings').select('*');
    if (error) throw error;
    return (data || []).map(mapMeetingRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const row = buildMeetingPgRow(doc);
    const { data, error } = await sb.from('meetings').insert(row).select().single();
    if (error) throwIfPgUniqueError(error, { meetingCode: 1 });
    return mapMeetingRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const row = buildMeetingPgRow(doc);
    const { id: _id, created_at: _c, ...updateFields } = row;
    const { data, error } = await sb
      .from('meetings')
      .update(updateFields)
      .eq('id', row.id)
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { meetingCode: 1 });
    return mapMeetingRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('meetings').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 5. MeetingParticipant <-> public.meeting_participants
// ---------------------------------------------------------------------------
function mapParticipantRowToDoc(row: any): PlainDoc {
  const meta = reviveDatesDeep(safeJsonParse(row.guest_name) || {});
  const fallbackStatus = String(row.status || 'waiting').toUpperCase();
  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingId: toObjId(fromPgUuid(row.meeting_id)),
    userId: row.user_id ? toObjId(fromPgUuid(row.user_id)) : toObjId(generateHex24Id()),
    displayName: meta.displayName || row.guest_name || 'Participant',
    email: meta.email || 'participant@connectly.app',
    avatarUrl: meta.avatarUrl ?? null,
    role: row.role || 'participant',
    admissionStatus: meta.admissionStatus || fallbackStatus,
    presenceStatus: meta.presenceStatus || 'OFFLINE',
    admissionSessionId: meta.admissionSessionId ?? null,
    requestedAt: meta.requestedAt ?? new Date(row.joined_at),
    admittedAt: meta.admittedAt ?? null,
    joinedAt: meta.joinedAt ?? (row.joined_at ? new Date(row.joined_at) : null),
    leftAt: row.left_at ? new Date(row.left_at) : meta.leftAt ?? null,
    decidedBy: meta.decidedBy ? toObjId(meta.decidedBy) : null,
    decidedAt: meta.decidedAt ?? null,
    rejectionReason: meta.rejectionReason ?? null,
    removalReason: meta.removalReason ?? null,
    tokenEpoch: meta.tokenEpoch ?? 1,
    tokenRevokedBefore: meta.tokenRevokedBefore ?? null,
    signalFenceVersion: meta.signalFenceVersion ?? 0,
    createdAt: meta.createdAt ?? new Date(row.joined_at),
    updatedAt: meta.updatedAt ?? new Date(row.joined_at),
  };
}

function buildParticipantPgRow(doc: PlainDoc) {
  const uuid = toPgUuid(doc._id);
  const now = new Date();
  const guestJson = JSON.stringify(
    toJsonSafe({
      displayName: doc.displayName || 'Participant',
      email: String(doc.email || 'participant@connectly.app').toLowerCase(),
      avatarUrl: doc.avatarUrl ?? null,
      admissionStatus: doc.admissionStatus || 'WAITING',
      presenceStatus: doc.presenceStatus || 'OFFLINE',
      admissionSessionId: doc.admissionSessionId ?? null,
      requestedAt: doc.requestedAt ?? now,
      admittedAt: doc.admittedAt ?? null,
      joinedAt: doc.joinedAt ?? null,
      leftAt: doc.leftAt ?? null,
      decidedBy: doc.decidedBy ?? null,
      decidedAt: doc.decidedAt ?? null,
      rejectionReason: doc.rejectionReason ?? null,
      removalReason: doc.removalReason ?? null,
      tokenEpoch: doc.tokenEpoch ?? 1,
      tokenRevokedBefore: doc.tokenRevokedBefore ?? null,
      signalFenceVersion: doc.signalFenceVersion ?? 0,
      createdAt: doc.createdAt ?? now,
      updatedAt: now,
    })
  );

  return {
    id: uuid,
    meeting_id: toPgUuid(doc.meetingId),
    user_id: doc.userId ? toPgUuid(doc.userId) : null,
    guest_name: guestJson,
    role: mapParticipantRoleToPg(doc.role),
    status: mapAdmissionToPg(doc.admissionStatus),
    joined_at: (doc.joinedAt ? new Date(doc.joinedAt) : now).toISOString(),
    left_at: doc.leftAt ? new Date(doc.leftAt).toISOString() : null,
  };
}

export const participantAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['meetingId', 'userId']],
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('meeting_participants').select('*');
    if (error) throw error;
    return (data || []).map(mapParticipantRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const row = buildParticipantPgRow(doc);
    const { data, error } = await sb.from('meeting_participants').insert(row).select().single();
    if (error) throwIfPgUniqueError(error, { meetingId: 1, userId: 1 });
    return mapParticipantRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const row = buildParticipantPgRow(doc);
    const { id: _id, ...updateFields } = row;
    const { data, error } = await sb
      .from('meeting_participants')
      .update(updateFields)
      .eq('id', row.id)
      .select()
      .single();
    if (error) throw error;
    return mapParticipantRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('meeting_participants').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 6. ChatMessage <-> public.chat_messages
// ---------------------------------------------------------------------------
function mapChatRowToDoc(row: any): PlainDoc {
  const meta = reviveDatesDeep(row.metadata || {});
  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingId: toObjId(fromPgUuid(row.meeting_id)),
    senderId: toObjId(fromPgUuid(row.sender_id)),
    senderName: row.sender_name,
    senderRole: meta.senderRole || 'participant',
    senderAvatarUrl: meta.senderAvatarUrl ?? null,
    content: row.content,
    clientMessageId: meta.clientMessageId ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.created_at),
  };
}

export const chatMessageAdapter: TableAdapter = {
  kind: 'supabase',
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('chat_messages').select('*');
    if (error) throw error;
    return (data || []).map(mapChatRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const uuid = toPgUuid(doc._id || generateHex24Id());
    const { data, error } = await sb
      .from('chat_messages')
      .insert({
        id: uuid,
        meeting_id: toPgUuid(doc.meetingId),
        sender_id: doc.senderId ? toPgUuid(doc.senderId) : null,
        sender_name: doc.senderName || 'Participant',
        content: doc.content,
        message_type: 'text',
        metadata: toJsonSafe({
          senderRole: doc.senderRole || 'participant',
          senderAvatarUrl: doc.senderAvatarUrl ?? null,
          clientMessageId: doc.clientMessageId ?? null,
        }),
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { meetingId: 1, clientMessageId: 1 });
    return mapChatRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const uuid = toPgUuid(doc._id);
    const { data, error } = await sb
      .from('chat_messages')
      .update({
        content: doc.content,
        metadata: toJsonSafe({
          senderRole: doc.senderRole || 'participant',
          senderAvatarUrl: doc.senderAvatarUrl ?? null,
          clientMessageId: doc.clientMessageId ?? null,
        }),
      })
      .eq('id', uuid)
      .select()
      .single();
    if (error) throw error;
    return mapChatRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('chat_messages').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 7. SharedFile <-> public.shared_files
// ---------------------------------------------------------------------------
function mapSharedFileRowToDoc(row: any): PlainDoc {
  const meta = reviveDatesDeep(safeJsonParse(row.storage_path) || { storageKey: row.storage_path });
  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingId: toObjId(fromPgUuid(row.meeting_id)),
    uploaderId: row.uploader_id ? toObjId(fromPgUuid(row.uploader_id)) : toObjId(generateHex24Id()),
    uploaderName: meta.uploaderName || 'Participant',
    uploaderRole: meta.uploaderRole || 'participant',
    uploaderAvatarUrl: meta.uploaderAvatarUrl ?? null,
    originalFilename: row.original_name,
    sanitizedFilename: row.filename,
    storageKey: meta.storageKey || row.storage_path,
    storageProvider: meta.storageProvider || 'supabase',
    mimeType: row.mime_type,
    extension: meta.extension || '',
    sizeBytes: Number(row.size_bytes),
    status: meta.status || (row.is_deleted ? 'DELETED' : 'AVAILABLE'),
    versionId: meta.versionId ?? null,
    checksumSha256: meta.checksumSha256 ?? null,
    pendingExpiresAt: meta.pendingExpiresAt ?? null,
    cleanupStatus: meta.cleanupStatus || 'NONE',
    cleanupRetries: meta.cleanupRetries ?? 0,
    cleanupClaimedAt: meta.cleanupClaimedAt ?? null,
    cleanupClaimedBy: meta.cleanupClaimedBy ?? null,
    cleanupClaimToken: meta.cleanupClaimToken ?? null,
    cleanupLastError: meta.cleanupLastError ?? null,
    isDeleted: Boolean(row.is_deleted),
    deletedAt: meta.deletedAt ?? null,
    deletedBy: meta.deletedBy ? toObjId(meta.deletedBy) : null,
    createdAt: new Date(row.created_at),
    updatedAt: meta.updatedAt ?? new Date(row.created_at),
  };
}

function buildSharedFilePgRow(doc: PlainDoc) {
  const storageJson = JSON.stringify(
    toJsonSafe({
      storageKey: doc.storageKey,
      storageProvider: doc.storageProvider || 'local',
      uploaderName: doc.uploaderName || 'Participant',
      uploaderRole: doc.uploaderRole || 'participant',
      uploaderAvatarUrl: doc.uploaderAvatarUrl ?? null,
      extension: doc.extension || '',
      status: doc.status || 'PENDING',
      versionId: doc.versionId ?? null,
      checksumSha256: doc.checksumSha256 ?? null,
      pendingExpiresAt: doc.pendingExpiresAt ?? null,
      cleanupStatus: doc.cleanupStatus || 'NONE',
      cleanupRetries: doc.cleanupRetries ?? 0,
      cleanupClaimedAt: doc.cleanupClaimedAt ?? null,
      cleanupClaimedBy: doc.cleanupClaimedBy ?? null,
      cleanupClaimToken: doc.cleanupClaimToken ?? null,
      cleanupLastError: doc.cleanupLastError ?? null,
      deletedAt: doc.deletedAt ?? null,
      deletedBy: doc.deletedBy ?? null,
      updatedAt: new Date(),
    })
  );
  return {
    id: toPgUuid(doc._id || generateHex24Id()),
    meeting_id: toPgUuid(doc.meetingId),
    uploader_id: doc.uploaderId ? toPgUuid(doc.uploaderId) : null,
    filename: doc.sanitizedFilename || doc.originalFilename,
    original_name: doc.originalFilename,
    mime_type: doc.mimeType,
    size_bytes: Number(doc.sizeBytes || 0),
    storage_path: storageJson,
    is_deleted: Boolean(doc.isDeleted),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  };
}

export const sharedFileAdapter: TableAdapter = {
  kind: 'supabase',
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('shared_files').select('*');
    if (error) throw error;
    return (data || []).map(mapSharedFileRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const row = buildSharedFilePgRow(doc);
    const { data, error } = await sb.from('shared_files').insert(row).select().single();
    if (error) throwIfPgUniqueError(error);
    return mapSharedFileRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const row = buildSharedFilePgRow(doc);
    const { id: _id, created_at: _c, ...updateFields } = row;
    const { data, error } = await sb.from('shared_files').update(updateFields).eq('id', row.id).select().single();
    if (error) throw error;
    return mapSharedFileRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('shared_files').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 8. Whiteboard <-> public.whiteboards (elements preserved as Map!)
// ---------------------------------------------------------------------------
function mapWhiteboardRowToDoc(row: any): PlainDoc {
  const snap = reviveDatesDeep(row.snapshot || {});
  const rawElements = Array.isArray(snap) ? {} : snap.elements || {};
  const elementsMap = new Map<string, any>();
  for (const [elKey, elVal] of Object.entries(rawElements)) {
    if (elVal && typeof elVal === 'object') {
      const revivedEl = { ...(elVal as Record<string, any>) };
      if (revivedEl.createdBy) revivedEl.createdBy = toObjId(revivedEl.createdBy);
      elementsMap.set(elKey, revivedEl);
    }
  }
  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingId: toObjId(fromPgUuid(row.meeting_id)),
    version: row.version ?? 0,
    elements: elementsMap,
    appliedOperationIds: Array.isArray(snap.appliedOperationIds) ? snap.appliedOperationIds : [],
    lastModifiedBy: snap.lastModifiedBy ? toObjId(snap.lastModifiedBy) : null,
    lastModifiedByName: snap.lastModifiedByName ?? null,
    lastClearedAt: snap.lastClearedAt ?? null,
    lastClearedBy: snap.lastClearedBy ? toObjId(snap.lastClearedBy) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function buildWhiteboardPgRow(doc: PlainDoc) {
  const snapshotJson = toJsonSafe({
    elements: doc.elements instanceof Map ? doc.elements : doc.elements || {},
    appliedOperationIds: doc.appliedOperationIds || [],
    lastModifiedBy: doc.lastModifiedBy ?? null,
    lastModifiedByName: doc.lastModifiedByName ?? null,
    lastClearedAt: doc.lastClearedAt ?? null,
    lastClearedBy: doc.lastClearedBy ?? null,
  });
  return {
    id: toPgUuid(doc._id || generateHex24Id()),
    meeting_id: toPgUuid(doc.meetingId),
    snapshot: snapshotJson,
    version: Number(doc.version ?? 0),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export const whiteboardAdapter: TableAdapter = {
  kind: 'supabase',
  uniqueFields: [['meetingId']],
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('whiteboards').select('*');
    if (error) throw error;
    return (data || []).map(mapWhiteboardRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const row = buildWhiteboardPgRow(doc);
    const { data, error } = await sb.from('whiteboards').insert(row).select().single();
    if (error) throwIfPgUniqueError(error, { meetingId: 1 });
    return mapWhiteboardRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const row = buildWhiteboardPgRow(doc);
    const { id: _id, created_at: _c, ...updateFields } = row;
    const { data, error } = await sb.from('whiteboards').update(updateFields).eq('id', row.id).select().single();
    if (error) throw error;
    return mapWhiteboardRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('whiteboards').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 9. WhiteboardOperation <-> public.whiteboard_operations
// ---------------------------------------------------------------------------
function mapWhiteboardOpRowToDoc(row: any): PlainDoc {
  const op = reviveDatesDeep(row.operation || {});
  if (op.element?.createdBy) op.element.createdBy = toObjId(op.element.createdBy);
  if (op.previousElement?.createdBy) op.previousElement.createdBy = toObjId(op.previousElement.createdBy);
  return {
    _id: toObjId(fromPgUuid(row.id)),
    meetingId: op.meetingId ? toObjId(op.meetingId) : toObjId(generateHex24Id()),
    whiteboardId: toObjId(fromPgUuid(row.whiteboard_id)),
    operationId: op.operationId,
    userId: row.user_id ? toObjId(fromPgUuid(row.user_id)) : toObjId(generateHex24Id()),
    userName: op.userName || 'Participant',
    type: op.type,
    elementId: op.elementId,
    element: op.element,
    previousElement: op.previousElement,
    sequence: Number(row.sequence_number),
    isUndone: Boolean(op.isUndone),
    undoneAt: op.undoneAt ?? null,
    createdAt: new Date(row.created_at),
  };
}

export const whiteboardOpAdapter: TableAdapter = {
  kind: 'supabase',
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('whiteboard_operations').select('*');
    if (error) throw error;
    return (data || []).map(mapWhiteboardOpRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    let wbUuid = doc.whiteboardId ? toPgUuid(doc.whiteboardId) : '';
    if (!wbUuid && doc.meetingId) {
      const { data: wb } = await sb
        .from('whiteboards')
        .select('id')
        .eq('meeting_id', toPgUuid(doc.meetingId))
        .maybeSingle();
      wbUuid = wb?.id || toPgUuid(generateHex24Id());
    }
    const opJson = toJsonSafe({
      meetingId: doc.meetingId,
      operationId: doc.operationId,
      userName: doc.userName || 'Participant',
      type: doc.type,
      elementId: doc.elementId,
      element: doc.element,
      previousElement: doc.previousElement,
      isUndone: Boolean(doc.isUndone),
      undoneAt: doc.undoneAt ?? null,
    });
    const { data, error } = await sb
      .from('whiteboard_operations')
      .insert({
        id: toPgUuid(doc._id || generateHex24Id()),
        whiteboard_id: wbUuid,
        user_id: doc.userId ? toPgUuid(doc.userId) : null,
        operation: opJson,
        sequence_number: Number(doc.sequence ?? 0),
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return mapWhiteboardOpRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const opJson = toJsonSafe({
      meetingId: doc.meetingId,
      operationId: doc.operationId,
      userName: doc.userName || 'Participant',
      type: doc.type,
      elementId: doc.elementId,
      element: doc.element,
      previousElement: doc.previousElement,
      isUndone: Boolean(doc.isUndone),
      undoneAt: doc.undoneAt ?? null,
    });
    const { data, error } = await sb
      .from('whiteboard_operations')
      .update({
        operation: opJson,
        sequence_number: Number(doc.sequence ?? 0),
      })
      .eq('id', toPgUuid(doc._id))
      .select()
      .single();
    if (error) throw error;
    return mapWhiteboardOpRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('whiteboard_operations').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// 10. Notification <-> public.notifications
// ---------------------------------------------------------------------------
function mapNotificationRowToDoc(row: any): PlainDoc {
  const bodyMeta = reviveDatesDeep(safeJsonParse(row.body));
  return {
    _id: toObjId(fromPgUuid(row.id)),
    userId: toObjId(fromPgUuid(row.user_id)),
    type: row.type,
    title: row.title,
    message: bodyMeta ? bodyMeta.message : row.body,
    meetingId: bodyMeta?.meetingId ? toObjId(bodyMeta.meetingId) : null,
    meetingCode: bodyMeta?.meetingCode ?? null,
    read: Boolean(row.is_read),
    readAt: bodyMeta?.readAt ?? null,
    deliveryKey: bodyMeta?.deliveryKey ?? null,
    metadata: bodyMeta?.metadata ?? {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.created_at),
  };
}

export const notificationAdapter: TableAdapter = {
  kind: 'supabase',
  async loadAll() {
    const sb = getSupabase();
    const { data, error } = await sb.from('notifications').select('*');
    if (error) throw error;
    return (data || []).map(mapNotificationRowToDoc);
  },
  async insert(doc) {
    const sb = getSupabase();
    const bodyJson = JSON.stringify(
      toJsonSafe({
        message: doc.message,
        meetingId: doc.meetingId ?? null,
        meetingCode: doc.meetingCode ?? null,
        readAt: doc.readAt ?? null,
        deliveryKey: doc.deliveryKey ?? null,
        metadata: doc.metadata ?? {},
      })
    );
    const { data, error } = await sb
      .from('notifications')
      .insert({
        id: toPgUuid(doc._id || generateHex24Id()),
        user_id: toPgUuid(doc.userId),
        title: doc.title,
        body: bodyJson,
        type: doc.type || 'MEETING_INVITATION',
        is_read: Boolean(doc.read),
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throwIfPgUniqueError(error, { deliveryKey: 1 });
    return mapNotificationRowToDoc(data);
  },
  async replace(doc) {
    const sb = getSupabase();
    const bodyJson = JSON.stringify(
      toJsonSafe({
        message: doc.message,
        meetingId: doc.meetingId ?? null,
        meetingCode: doc.meetingCode ?? null,
        readAt: doc.readAt ?? null,
        deliveryKey: doc.deliveryKey ?? null,
        metadata: doc.metadata ?? {},
      })
    );
    const { data, error } = await sb
      .from('notifications')
      .update({
        title: doc.title,
        body: bodyJson,
        is_read: Boolean(doc.read),
      })
      .eq('id', toPgUuid(doc._id))
      .select()
      .single();
    if (error) throw error;
    return mapNotificationRowToDoc(data);
  },
  async remove(id) {
    const sb = getSupabase();
    const { error } = await sb.from('notifications').delete().eq('id', toPgUuid(id));
    if (error) throw error;
  },
};

// Attach indexed Postgres equality pushdowns to core table adapters so point lookups
// and room-scoped queries execute filtered SQL instead of loading entire tables.
userPreferencesAdapter.loadFiltered = createFilteredSupabaseLoader(
  'user_preferences',
  mapPrefRowToDoc,
  [
    { field: '_id', column: 'id', transform: toPgUuid },
    { field: 'userId', column: 'user_id', transform: toPgUuid },
  ],
  (r) => Boolean(safeJsonParse(r.audio_input_device))
);
authSessionAdapter.loadFiltered = createFilteredSupabaseLoader('auth_sessions', mapSessionRowToDoc, [
  { field: '_id', column: 'id', transform: toPgUuid },
  { field: 'userId', column: 'user_id', transform: toPgUuid },
  { field: 'refreshTokenHash', column: 'refresh_token' },
]);
meetingAdapter.loadFiltered = createFilteredSupabaseLoader('meetings', mapMeetingRowToDoc, [
  { field: '_id', column: 'id', transform: toPgUuid },
  { field: 'meetingCode', column: 'code', transform: (v) => v.toLowerCase().trim() },
  { field: 'hostId', column: 'host_id', transform: toPgUuid },
]);
participantAdapter.loadFiltered = createFilteredSupabaseLoader(
  'meeting_participants',
  mapParticipantRowToDoc,
  [
    { field: '_id', column: 'id', transform: toPgUuid },
    { field: 'meetingId', column: 'meeting_id', transform: toPgUuid },
    { field: 'userId', column: 'user_id', transform: toPgUuid },
  ]
);
chatMessageAdapter.loadFiltered = createFilteredSupabaseLoader('chat_messages', mapChatRowToDoc, [
  { field: '_id', column: 'id', transform: toPgUuid },
  { field: 'meetingId', column: 'meeting_id', transform: toPgUuid },
  { field: 'senderId', column: 'sender_id', transform: toPgUuid },
]);
sharedFileAdapter.loadFiltered = createFilteredSupabaseLoader('shared_files', mapSharedFileRowToDoc, [
  { field: '_id', column: 'id', transform: toPgUuid },
  { field: 'meetingId', column: 'meeting_id', transform: toPgUuid },
  { field: 'uploaderId', column: 'uploader_id', transform: toPgUuid },
]);
whiteboardAdapter.loadFiltered = createFilteredSupabaseLoader('whiteboards', mapWhiteboardRowToDoc, [
  { field: '_id', column: 'id', transform: toPgUuid },
  { field: 'meetingId', column: 'meeting_id', transform: toPgUuid },
]);
whiteboardOpAdapter.loadFiltered = createFilteredSupabaseLoader(
  'whiteboard_operations',
  mapWhiteboardOpRowToDoc,
  [
    { field: '_id', column: 'id', transform: toPgUuid },
    { field: 'whiteboardId', column: 'whiteboard_id', transform: toPgUuid },
    { field: 'userId', column: 'user_id', transform: toPgUuid },
  ]
);
notificationAdapter.loadFiltered = createFilteredSupabaseLoader(
  'notifications',
  mapNotificationRowToDoc,
  [
    { field: '_id', column: 'id', transform: toPgUuid },
    { field: 'userId', column: 'user_id', transform: toPgUuid },
  ]
);

// ---------------------------------------------------------------------------
// 11. Operational Supabase Tables (with Schema-Cache Fallback Safety)
// ---------------------------------------------------------------------------
const missingTableWarned = new Set<string>();

function isTableMissingInSchemaCache(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /could not find the table/i.test(msg) ||
    /relation .* does not exist/i.test(msg)
  );
}

function warnMissingOperationalTableOnce(tableName: string): void {
  if (missingTableWarned.has(tableName)) return;
  missingTableWarned.add(tableName);
  console.warn(
    `[Supabase] Operational table 'public.${tableName}' is not created yet; apply supabase/migrations/20261125000001_connectly_full_supabase.sql in Supabase SQL Editor. Using in-process store until created.`
  );
}

export function createMemoryAdapter(defaults: Record<string, any> = {}): TableAdapter {
  const store = new Map<string, PlainDoc>();
  return {
    kind: 'memory',
    async loadAll() {
      return Array.from(store.values()).map((d) => cloneValue(d));
    },
    async insert(doc) {
      const next = { ...cloneValue(defaults), ...cloneValue(doc) };
      if (!next._id) next._id = new Types.ObjectId(generateHex24Id());
      const now = new Date();
      if (!next.createdAt) next.createdAt = now;
      if (!next.updatedAt) next.updatedAt = now;
      store.set(String(next._id), cloneValue(next));
      return next;
    },
    async replace(doc) {
      const key = String(doc._id);
      const next = { ...cloneValue(defaults), ...cloneValue(doc), updatedAt: new Date() };
      store.set(key, cloneValue(next));
      return next;
    },
    async remove(id) {
      store.delete(String(id));
    },
  };
}

interface OperationalAdapterConfig {
  tableName: string;
  defaults?: Record<string, any>;
  uniqueFields?: string[][];
  fixedKindFilter?: { column: string; value: string };
  toRow: (doc: PlainDoc) => Record<string, any>;
  fromRow: (row: any) => PlainDoc;
  buildFilteredQuery?: (query: any, filter: PlainDoc) => any;
}

function createSupabaseOperationalAdapter(cfg: OperationalAdapterConfig): TableAdapter {
  const fallback = createMemoryAdapter(cfg.defaults || {});

  return {
    kind: 'supabase',
    uniqueFields: cfg.uniqueFields,
    async loadAll() {
      const sb = getSupabase();
      let query: any = sb.from(cfg.tableName).select('*');
      if (cfg.fixedKindFilter) {
        query = query.eq(cfg.fixedKindFilter.column, cfg.fixedKindFilter.value);
      }
      const { data, error } = await query;
      if (error) {
        if (isTableMissingInSchemaCache(error)) {
          warnMissingOperationalTableOnce(cfg.tableName);
          return fallback.loadAll();
        }
        throw error;
      }
      return (data || []).map(cfg.fromRow);
    },
    async loadFiltered(filter: PlainDoc) {
      const sb = getSupabase();
      let query: any = sb.from(cfg.tableName).select('*');
      if (cfg.fixedKindFilter) {
        query = query.eq(cfg.fixedKindFilter.column, cfg.fixedKindFilter.value);
      }
      if (cfg.buildFilteredQuery) {
        query = cfg.buildFilteredQuery(query, filter);
      } else {
        const idEq = extractScalarEq(filter, '_id');
        if (idEq) query = query.eq('id', idEq);
      }
      const { data, error } = await query;
      if (error) {
        if (isTableMissingInSchemaCache(error)) {
          warnMissingOperationalTableOnce(cfg.tableName);
          return fallback.loadAll();
        }
        throw error;
      }
      return (data || []).map(cfg.fromRow);
    },
    async insert(doc) {
      const sb = getSupabase();
      const row = cfg.toRow(doc);
      const { data, error } = await sb.from(cfg.tableName).insert(row).select().single();
      if (error) {
        if (isTableMissingInSchemaCache(error)) {
          warnMissingOperationalTableOnce(cfg.tableName);
          return fallback.insert(doc);
        }
        throwIfPgUniqueError(error);
      }
      return cfg.fromRow(data);
    },
    async replace(doc) {
      const sb = getSupabase();
      const row = cfg.toRow(doc);
      const { id, created_at: _c, ...updateFields } = row;
      const { data, error } = await sb
        .from(cfg.tableName)
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        if (isTableMissingInSchemaCache(error)) {
          warnMissingOperationalTableOnce(cfg.tableName);
          return fallback.replace(doc);
        }
        throwIfPgUniqueError(error);
      }
      return cfg.fromRow(data);
    },
    async remove(id) {
      const sb = getSupabase();
      const { error } = await sb.from(cfg.tableName).delete().eq('id', String(id));
      if (error) {
        if (isTableMissingInSchemaCache(error)) {
          warnMissingOperationalTableOnce(cfg.tableName);
          return fallback.remove(id);
        }
        throw error;
      }
    },
  };
}

function reviveOperationalPayload(payload: any, fallbackId: string, objIdKeys: string[]): PlainDoc {
  const doc = reviveDatesDeep(payload || {});
  doc._id = maybeToObjId(fallbackId);
  for (const k of objIdKeys) {
    if (doc[k] && typeof doc[k] === 'string' && Types.ObjectId.isValid(doc[k])) {
      doc[k] = new Types.ObjectId(doc[k]);
    }
  }
  return doc;
}

export const scheduledReminderAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'scheduled_reminders',
  defaults: { status: 'PENDING', retryCount: 0, claimFenceVersion: 0 },
  uniqueFields: [['meetingId', 'userId', 'triggerMinutesBefore']],
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    meeting_id: toPgUuid(doc.meetingId),
    user_id: toPgUuid(doc.userId),
    remind_at: new Date(doc.remindAt || Date.now()).toISOString(),
    trigger_minutes_before: Number(doc.triggerMinutesBefore ?? 15),
    status: String(doc.status || 'PENDING'),
    payload: toJsonSafe(doc),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) =>
    reviveOperationalPayload(row.payload, row.id, ['meetingId', 'userId']),
  buildFilteredQuery: (q, filter) => {
    const idEq = extractScalarEq(filter, '_id');
    const meetingEq = extractScalarEq(filter, 'meetingId');
    const userEq = extractScalarEq(filter, 'userId');
    const statusEq = extractScalarEq(filter, 'status');
    if (idEq) q = q.eq('id', idEq);
    if (meetingEq) q = q.eq('meeting_id', toPgUuid(meetingEq));
    if (userEq) q = q.eq('user_id', toPgUuid(userEq));
    if (statusEq) q = q.eq('status', statusEq);
    return q;
  },
});

export const meetingRealtimeEventAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'meeting_realtime_events',
  defaults: { status: 'PENDING', attemptCount: 0 },
  uniqueFields: [['eventId']],
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    event_id: String(doc.eventId || doc._id || generateHex24Id()),
    meeting_id: toPgUuid(doc.meetingId),
    type: String(doc.type || 'PARTICIPANT_JOINED'),
    status: String(doc.status || 'PENDING'),
    payload: toJsonSafe(doc),
    terminal_at: doc.terminalAt ? new Date(doc.terminalAt).toISOString() : null,
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) =>
    reviveOperationalPayload(row.payload, row.id, ['meetingId', 'targetUserId']),
  buildFilteredQuery: (q, filter) => {
    const idEq = extractScalarEq(filter, '_id');
    const evEq = extractScalarEq(filter, 'eventId');
    const meetingEq = extractScalarEq(filter, 'meetingId');
    const statusEq = extractScalarEq(filter, 'status');
    if (idEq) q = q.eq('id', idEq);
    if (evEq) q = q.eq('event_id', evEq);
    if (meetingEq) q = q.eq('meeting_id', toPgUuid(meetingEq));
    if (statusEq) q = q.eq('status', statusEq);
    return q;
  },
});

export const livekitRevocationEventAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'livekit_revocation_events',
  uniqueFields: [['seq']],
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    seq: doc.seq !== undefined && doc.seq !== null ? Number(doc.seq) : null,
    room_name: String(doc.meetingCode || doc.roomName || ''),
    participant_identity: String(doc.identity || doc.participantIdentity || ''),
    reason: String(doc.kind || doc.reason || ''),
    payload: toJsonSafe(doc),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  }),
  fromRow: (row) =>
    reviveOperationalPayload(row.payload, row.id, ['meetingId', 'userId']),
  buildFilteredQuery: (q, filter) => {
    const idEq = extractScalarEq(filter, '_id');
    if (idEq) q = q.eq('id', idEq);
    if (typeof filter?.seq === 'number') q = q.eq('seq', filter.seq);
    return q;
  },
});

export const livekitRevocationCounterAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'livekit_revocation_state',
  defaults: { seq: 0 },
  fixedKindFilter: { column: 'kind', value: 'counter' },
  toRow: (doc) => ({
    id: String(doc._id || 'livekit_revocation_global_seq'),
    kind: 'counter',
    payload: toJsonSafe(doc),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) => ({ ...reviveDatesDeep(row.payload || {}), _id: String(row.id) }),
});

export const livekitRevocationCursorAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'livekit_revocation_state',
  defaults: { lastContiguousSeq: 0, resumeToken: null },
  fixedKindFilter: { column: 'kind', value: 'cursor' },
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    kind: 'cursor',
    payload: toJsonSafe(doc),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) => ({ ...reviveDatesDeep(row.payload || {}), _id: String(row.id) }),
});

export const livekitEvictionJobAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'livekit_eviction_jobs',
  defaults: { status: 'PENDING', attempts: 0, maxAttempts: 5 },
  uniqueFields: [['jobId']],
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    job_id: String(doc.jobId || doc._id || generateHex24Id()),
    room_name: String(doc.meetingCode || ''),
    participant_identity: String(doc.identity || ''),
    status: String(doc.status || 'PENDING'),
    attempts: Number(doc.attempts ?? 0),
    payload: toJsonSafe(doc),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) =>
    reviveOperationalPayload(row.payload, row.id, ['meetingId', 'userId']),
  buildFilteredQuery: (q, filter) => {
    const idEq = extractScalarEq(filter, '_id');
    const jobEq = extractScalarEq(filter, 'jobId');
    const statusEq = extractScalarEq(filter, 'status');
    if (idEq) q = q.eq('id', idEq);
    if (jobEq) q = q.eq('job_id', jobEq);
    if (statusEq) q = q.eq('status', statusEq);
    return q;
  },
});

export const securityAuditEntryAdapter: TableAdapter = createSupabaseOperationalAdapter({
  tableName: 'security_audit_entries',
  uniqueFields: [['eventId']],
  toRow: (doc) => ({
    id: String(doc._id || generateHex24Id()),
    event_id: String(doc.eventId || doc._id || generateHex24Id()),
    event_type: String(doc.eventType || 'SECURITY_EVENT'),
    severity: String(doc.severity || 'INFO'),
    user_id: doc.userId ? String(doc.userId) : null,
    ip_address: doc.ip || null,
    user_agent: doc.userAgent || null,
    details: toJsonSafe(doc),
    created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  fromRow: (row) =>
    reviveOperationalPayload(row.details, row.id, []),
  buildFilteredQuery: (q, filter) => {
    const idEq = extractScalarEq(filter, '_id');
    const evEq = extractScalarEq(filter, 'eventId');
    const typeEq = extractScalarEq(filter, 'eventType');
    const userEq = extractScalarEq(filter, 'userId');
    if (idEq) q = q.eq('id', idEq);
    if (evEq) q = q.eq('event_id', evEq);
    if (typeEq) q = q.eq('event_type', typeEq);
    if (userEq) q = q.eq('user_id', userEq);
    return q;
  },
});
