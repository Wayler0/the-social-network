import { call } from './api';

/** Alumni keep access: link a personal email while the campus email works (API: /api/me/personal-email). */
export const linkPersonalEmail = (email: string) => call<{ resendAfterSeconds: number }>('POST', '/api/me/personal-email', { email });
export const confirmPersonalEmail = (code: string) => call<{ personalEmail: string }>('POST', '/api/me/personal-email/verify', { code });
export const unlinkPersonalEmail = () => call<void>('DELETE', '/api/me/personal-email');
