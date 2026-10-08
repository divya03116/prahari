/**
 * Message keys for the values the data model stores (roles, tiers, statuses…).
 * The stored value never changes with the language; only its label does.
 */
import type { ActionStatus, ReportType, Role, Shift, Tier, Verdict } from '@/shared/constants';

import type { MessageKey } from './en';

export const roleKey = (role: Role): MessageKey => `role.${role}`;
export const roleDescriptionKey = (role: Role): MessageKey => `roleDesc.${role}`;
export const tierKey = (tier: Tier): MessageKey => `tier.${tier}`;
export const actionStatusKey = (status: ActionStatus): MessageKey => `actionStatus.${status}`;
export const verdictKey = (verdict: Verdict): MessageKey => `verdict.${verdict}`;
export const reportTypeKey = (type: ReportType): MessageKey => `type.${type}`;
export const shiftKey = (shift: Shift): MessageKey => `shift.${shift}`;
