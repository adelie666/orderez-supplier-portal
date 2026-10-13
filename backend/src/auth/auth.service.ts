import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: number;
  username: string;
  role: 'admin' | 'supplier';
  supplierId: number | null;
  supplierName?: string | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { supplier: true },
    });
    if (!user || user.status !== 1) throw new UnauthorizedException('Credenziali non valide');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenziali non valide');

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role as 'admin' | 'supplier',
      supplierId: user.supplierId ?? null,
      supplierName: user.supplier?.supplierName ?? null,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: payload,
    };
  }

  async profile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { supplier: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      supplierId: user.supplierId,
      supplierName: user.supplier?.supplierName ?? null,
    };
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Password attuale non corretta');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    return { ok: true };
  }
}
