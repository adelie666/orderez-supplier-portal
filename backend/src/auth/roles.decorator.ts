import { SetMetadata } from '@nestjs/common';

export type Role = 'admin' | 'supplier';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
