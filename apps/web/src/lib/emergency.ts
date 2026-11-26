import { call } from './api';

/** Emergency button (API docs section 18). Numbers come from the campus row, never from code. */
export type EmergencyContact = { label: string; phone: string };
export type EmergencyAlert = {
  id: string; message: string | null; status: 'open' | 'handled'; createdAt: string; handledAt: string | null; handledBy: string | null;
  member: { id: string; name: string | null; memberType: string | null; course: string | null; yearOfStudy: number | null } | null;
};
export const getEmergencyContacts = () => call<{ contacts: EmergencyContact[] }>('GET', '/api/emergency');
export const sendEmergencyAlert = (message: string) => call<{ id: string; contacts: EmergencyContact[] }>('POST', '/api/emergency', message ? { message } : {});
export const getEmergencyAlerts = (status: 'open' | 'handled') => call<{ items: EmergencyAlert[] }>('GET', `/api/admin/emergencies?status=${status}`);
export const markEmergencyHandled = (id: string) => call<void>('POST', `/api/admin/emergencies/${encodeURIComponent(id)}/handled`);
