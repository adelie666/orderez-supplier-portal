import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, ResetPasswordDto, UpdateAccountDto } from './dto/create-account.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(role?: string) {
    const rows = await this.prisma.user.findMany({
      where: role ? { role } : {},
      orderBy: { id: 'desc' },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
        supplierId: true,
        supplier: { select: { id: true, supplierName: true } },
      },
    });
    return { rows, total: rows.length };
  }

  /** 开通供应商账号（文档 §8.2 /accounts） */
  async createSupplierAccount(dto: CreateAccountDto) {
    if (!dto.supplierId) throw new BadRequestException('Fornitore obbligatorio');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) throw new BadRequestException('Fornitore non trovato');

    const existing = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existing) throw new ConflictException('Username gia utilizzato');

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: 'supplier',
        supplierId: dto.supplierId,
        status: 1,
      },
      select: { id: true, username: true, role: true, status: true, supplierId: true },
    });
    return user;
  }

  async update(id: number, dto: UpdateAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Account non trovato');
    const data: { status?: number; supplierId?: number } = {};
    if (dto.status !== undefined) data.status = dto.status === 0 ? 0 : 1;
    if (dto.supplierId !== undefined) {
      if (user.role !== 'supplier') throw new BadRequestException('Solo gli account fornitore hanno un fornitore');
      data.supplierId = dto.supplierId;
    }
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, role: true, status: true, supplierId: true },
    });
  }

  async resetPassword(id: number, dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Account non trovato');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(dto.password, 10) },
    });
    return { ok: true };
  }

  async remove(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Account non trovato');
    if (user.role === 'admin') throw new BadRequestException('Non puoi eliminare un account amministratore');
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
